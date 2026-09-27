'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { runRpc, type ActionResult } from '@/lib/errors';
import type { ReactionEmoji } from '@/lib/reactions';

export interface MarketComment {
  id: string;
  market_id: string;
  user_id: string;
  body: string;
  revealed_side: 'yes' | 'no' | 'over' | 'under' | null;
  revealed_option_id: string | null;
  revealed_amount: number | null;
  created_at: string;
  deleted_at: string | null;
}

export async function postComment(groupId: string, marketId: string, body: string): Promise<ActionResult<MarketComment>> {
  const supabase = await createClient();
  const result = await runRpc<MarketComment>(await supabase.rpc('post_market_comment', { p_market_id: marketId, p_body: body }));
  if (result.error) return result;
  revalidatePath(`/groups/${groupId}/markets/${marketId}`);
  return result;
}

/** Snapshots the caller's own bet (side/option + amount) into a new comment — see the
 *  migration for why this never touches `bets`' own RLS. */
export async function revealBet(groupId: string, marketId: string, body: string): Promise<ActionResult<MarketComment>> {
  const supabase = await createClient();
  const result = await runRpc<MarketComment>(await supabase.rpc('reveal_bet_in_comment', { p_market_id: marketId, p_body: body }));
  if (result.error) return result;
  revalidatePath(`/groups/${groupId}/markets/${marketId}`);
  return result;
}

/** 4e's "Reveal" under a comment you've already posted: attaches your bet to that comment rather
 *  than posting a new one (reveal_bet_on_comment, 20260927100000). */
export async function revealBetOnComment(groupId: string, marketId: string, commentId: string): Promise<ActionResult<MarketComment>> {
  const supabase = await createClient();
  const result = await runRpc<MarketComment>(await supabase.rpc('reveal_bet_on_comment', { p_comment_id: commentId }));
  if (result.error) return result;
  revalidatePath(`/groups/${groupId}/markets/${marketId}`);
  return result;
}

export async function deleteComment(groupId: string, marketId: string, commentId: string): Promise<ActionResult<null>> {
  const supabase = await createClient();
  const result = await runRpc<null>(await supabase.rpc('delete_market_comment', { p_comment_id: commentId }));
  if (result.error) return result;
  revalidatePath(`/groups/${groupId}/markets/${marketId}`);
  return result;
}

export async function reactToComment(
  groupId: string,
  marketId: string,
  commentId: string,
  emoji: ReactionEmoji
): Promise<ActionResult<ReactionEmoji | null>> {
  const supabase = await createClient();
  const result = await runRpc<ReactionEmoji | null>(
    await supabase.rpc('react_to_comment', { p_comment_id: commentId, p_emoji: emoji })
  );
  if (result.error) return result;
  revalidatePath(`/groups/${groupId}/markets/${marketId}`);
  return result;
}
