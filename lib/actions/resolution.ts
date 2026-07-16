'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { runRpc, type ActionResult } from '@/lib/errors';
import type { Market } from './markets';

const RESOLUTION_PROOF_BUCKET = 'resolution-proofs';

export interface ResolutionProposal {
  id: string;
  market_id: string;
  proposer_id: string;
  proposed_outcome: 'yes' | 'no' | 'over' | 'under' | 'void' | null;
  proposed_option_id: string | null;
  justification: string | null;
  actual_value: number | null;
  proposed_at: string;
  finalized: boolean;
  votes_revealed_at: string | null;
  photo_path: string | null;
}

export interface Challenge {
  id: string;
  market_id: string;
  challenger_id: string;
  created_at: string;
}

/** A proposal is either an outcome ('yes'/'no'/'over'/'under'/'void') or a specific option id (multiple_choice only — VOID still goes through `outcome`, never `optionId`). */
export type ProposalChoice = { outcome: 'yes' | 'no' | 'over' | 'under' | 'void' } | { optionId: string };

/** Optional proof photo, passed as FormData (not a bare File) since that's the pattern Server Actions reliably support for file payloads. Uploaded before the RPC call so propose_resolution can store the resulting path atomically with the rest of the proposal. */
export async function proposeResolution(
  groupId: string,
  marketId: string,
  choice: ProposalChoice,
  justification?: string,
  actualValue?: number,
  photo?: FormData
): Promise<ActionResult<ResolutionProposal>> {
  const supabase = await createClient();

  let photoPath: string | null = null;
  const photoFile = photo?.get('photo');
  if (photoFile instanceof File) {
    const admin = createAdminClient();
    photoPath = `${marketId}/${crypto.randomUUID()}.jpg`;
    const { error: uploadError } = await admin.storage
      .from(RESOLUTION_PROOF_BUCKET)
      .upload(photoPath, photoFile, { contentType: photoFile.type || 'image/jpeg' });
    if (uploadError) return { error: 'Could not upload the photo. Try again.' };
  }

  const result = await runRpc<ResolutionProposal>(
    await supabase.rpc('propose_resolution', {
      p_market_id: marketId,
      p_outcome: 'outcome' in choice ? choice.outcome : null,
      p_justification: justification ?? null,
      p_actual_value: actualValue ?? null,
      p_option_id: 'optionId' in choice ? choice.optionId : null,
      p_photo_path: photoPath,
    })
  );
  if (result.error) return result;
  revalidatePath(`/groups/${groupId}/markets/${marketId}`);
  return result;
}

/**
 * Mints a short-lived signed URL for a proposal's proof photo, only after
 * confirming the requesting user can actually see this market and proposal —
 * both queries below run through the per-request client, so they're subject
 * to the exact same RLS (is_market_visible-backed) gate as everywhere else.
 * The service-role client is only reached for the narrow, unavoidable task
 * of signing a URL against a bucket with no client-facing policies at all.
 * Voided markets are excluded on top of RLS: a void means the group never
 * settled on an outcome, so there's nothing left for the photo to prove.
 */
export async function getResolutionProofUrl(marketId: string): Promise<ActionResult<string>> {
  const supabase = await createClient();
  const [{ data: market }, { data: proposal }] = await Promise.all([
    supabase.from('visible_markets').select('status').eq('id', marketId).maybeSingle(),
    supabase.from('resolution_proposals').select('photo_path').eq('market_id', marketId).maybeSingle(),
  ]);
  if (!market || market.status === 'voided' || !proposal?.photo_path) {
    return { error: 'No proof photo available.' };
  }

  const admin = createAdminClient();
  const { data: signed, error } = await admin.storage
    .from(RESOLUTION_PROOF_BUCKET)
    .createSignedUrl(proposal.photo_path, 60);
  if (error || !signed) return { error: 'Could not load the photo. Try again.' };
  return { data: signed.signedUrl };
}

export async function challengeResolution(groupId: string, marketId: string, reason?: string): Promise<ActionResult<Challenge>> {
  const supabase = await createClient();
  const result = await runRpc<Challenge>(
    await supabase.rpc('challenge_resolution', { p_market_id: marketId, p_reason: reason ?? null })
  );
  if (result.error) return result;
  revalidatePath(`/groups/${groupId}/markets/${marketId}`);
  return result;
}

/** A ballot is either an outcome ('yes'/'no'/'over'/'under'/'void') or a specific option id (multiple_choice only — VOID still goes through `outcome`, never `optionId`). */
export type VoteChoice = { outcome: 'yes' | 'no' | 'over' | 'under' | 'void' } | { optionId: string };

export async function castVote(groupId: string, marketId: string, choice: VoteChoice): Promise<ActionResult<null>> {
  const supabase = await createClient();
  const result = await runRpc<null>(
    await supabase.rpc('cast_vote', {
      p_market_id: marketId,
      p_outcome: 'outcome' in choice ? choice.outcome : null,
      p_option_id: 'optionId' in choice ? choice.optionId : null,
    })
  );
  if (result.error) return result;
  revalidatePath(`/groups/${groupId}/markets/${marketId}`);
  return result;
}

/** Manual "finalize now" trigger — normally expire_stale() (cron) does this once the relevant timer has elapsed; this just re-checks the same windows early. */
export async function finalizeMarket(groupId: string, marketId: string): Promise<ActionResult<Market>> {
  const supabase = await createClient();
  const result = await runRpc<Market>(await supabase.rpc('finalize_market', { p_market_id: marketId }));
  if (result.error) return result;
  revalidatePath(`/groups/${groupId}/markets/${marketId}`);
  revalidatePath(`/groups/${groupId}/markets/${marketId}/reveal`);
  return result;
}

/** Owner-only kill switch: refunds every stake and voids the market outright, at any stage before it's already settled. */
export async function voidMarket(groupId: string, marketId: string): Promise<ActionResult<Market>> {
  const supabase = await createClient();
  const result = await runRpc<Market>(await supabase.rpc('void_market_by_owner', { p_market_id: marketId }));
  if (result.error) return result;
  revalidatePath(`/groups/${groupId}/markets/${marketId}`);
  revalidatePath(`/groups/${groupId}/markets/${marketId}/reveal`);
  return result;
}

/** Fallback for the one case voidMarket can never cover: the group owner is @mentioned in this market, so they can't see it, let alone void it. Only the market's creator can call this, and only while the owner is actually a subject. */
export async function voidMarketAsCreator(groupId: string, marketId: string): Promise<ActionResult<Market>> {
  const supabase = await createClient();
  const result = await runRpc<Market>(await supabase.rpc('void_market_by_creator', { p_market_id: marketId }));
  if (result.error) return result;
  revalidatePath(`/groups/${groupId}/markets/${marketId}`);
  revalidatePath(`/groups/${groupId}/markets/${marketId}/reveal`);
  return result;
}
