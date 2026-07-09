'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { runRpc, type ActionResult } from '@/lib/errors';
import type { Market } from './markets';

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
}

export interface Challenge {
  id: string;
  market_id: string;
  challenger_id: string;
  created_at: string;
}

/** A proposal is either an outcome ('yes'/'no'/'over'/'under'/'void') or a specific option id (multiple_choice only — VOID still goes through `outcome`, never `optionId`). */
export type ProposalChoice = { outcome: 'yes' | 'no' | 'over' | 'under' | 'void' } | { optionId: string };

export async function proposeResolution(
  groupId: string,
  marketId: string,
  choice: ProposalChoice,
  justification?: string,
  actualValue?: number
): Promise<ActionResult<ResolutionProposal>> {
  const supabase = await createClient();
  const result = await runRpc<ResolutionProposal>(
    await supabase.rpc('propose_resolution', {
      p_market_id: marketId,
      p_outcome: 'outcome' in choice ? choice.outcome : null,
      p_justification: justification ?? null,
      p_actual_value: actualValue ?? null,
      p_option_id: 'optionId' in choice ? choice.optionId : null,
    })
  );
  if (result.error) return result;
  revalidatePath(`/groups/${groupId}/markets/${marketId}`);
  return result;
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
