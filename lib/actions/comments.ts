'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { runRpc, toActionError, friendlyMessage, type ActionResult } from '@/lib/errors';
import { MARKET_COMMENT_MAX_LENGTH } from '@/lib/limits';

export interface MarketComment {
  id: string;
  market_id: string;
  author_id: string | null;
  parent_id: string | null;
  body: string;
  created_at: string;
  deleted_at: string | null;
  author_nickname: string | null;
}

export interface BallotProgress {
  votes_cast: number;
  eligible_voters: number;
  closes_at: string;
  has_voted: boolean;
}

/** Deliberately not runRpc(): list_market_comments returns a table of rows, and runRpc
 *  unwraps to data[0]. Same posture as listPublicGroups(). */
export async function listMarketComments(marketId: string): Promise<ActionResult<MarketComment[]>> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('list_market_comments', { p_market_id: marketId });
  if (error) return { error: friendlyMessage(toActionError(error)) };
  return { data: (data ?? []) as MarketComment[] };
}

export async function postMarketComment(
  groupId: string,
  marketId: string,
  body: string,
  parentId?: string | null
): Promise<ActionResult<MarketComment>> {
  const trimmed = body.trim();
  if (!trimmed) return { error: 'Comment cannot be empty.' };
  if (trimmed.length > MARKET_COMMENT_MAX_LENGTH) {
    return { error: `Comment must be ${MARKET_COMMENT_MAX_LENGTH} characters or fewer.` };
  }

  const supabase = await createClient();
  const result = await runRpc<MarketComment>(
    await supabase.rpc('post_market_comment', {
      p_market_id: marketId,
      p_body: trimmed,
      p_parent_id: parentId ?? null,
    })
  );
  if (result.error) return result;
  revalidatePath(`/groups/${groupId}/markets/${marketId}`);
  return result;
}

export async function deleteMarketComment(
  groupId: string,
  marketId: string,
  commentId: string
): Promise<ActionResult<MarketComment>> {
  const supabase = await createClient();
  const result = await runRpc<MarketComment>(
    await supabase.rpc('delete_market_comment', { p_comment_id: commentId })
  );
  if (result.error) return result;
  revalidatePath(`/groups/${groupId}/markets/${marketId}`);
  return result;
}

/** Aggregate sealed-ballot progress only. Never returns names or per-option tallies. */
export async function getBallotProgress(marketId: string): Promise<ActionResult<BallotProgress>> {
  const supabase = await createClient();
  const result = await runRpc<BallotProgress>(
    await supabase.rpc('get_ballot_progress', { p_market_id: marketId }).maybeSingle()
  );
  if (result.error) return result;
  if (!result.data) return { error: 'Market not found.' };
  return result;
}
