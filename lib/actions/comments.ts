'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { runRpc, type ActionResult } from '@/lib/errors';

export interface MarketComment {
  id: string;
  market_id: string;
  user_id: string | null;
  body: string;
  created_at: string;
}

/** Posts one comment. Every rule (member-only via is_market_visible, not voided, not a public
    group, trimmed/non-empty/500 chars) is add_market_comment()'s; the push rule (5+ comments in
    a minute, once an hour) fires inside the same transaction, never from here. */
export async function addMarketComment(groupId: string, marketId: string, body: string): Promise<ActionResult<MarketComment>> {
  const supabase = await createClient();
  const result = await runRpc<MarketComment>(await supabase.rpc('add_market_comment', { p_market_id: marketId, p_body: body }));
  if (result.error) return result;
  revalidatePath(`/groups/${groupId}/markets/${marketId}`);
  revalidatePath(`/groups/${groupId}/markets/${marketId}/reveal`);
  return result;
}

/** Soft delete: the author, or the group's owner/moderator. */
export async function deleteMarketComment(groupId: string, marketId: string, commentId: string): Promise<ActionResult<null>> {
  const supabase = await createClient();
  const result = await runRpc<null>(await supabase.rpc('delete_market_comment', { p_comment_id: commentId }));
  if (result.error) return result;
  revalidatePath(`/groups/${groupId}/markets/${marketId}`);
  revalidatePath(`/groups/${groupId}/markets/${marketId}/reveal`);
  return { data: null };
}

/** "I've opened the thread": stamps market_comment_reads.last_read_at, which clears the card's
    unread badge and drops the viewer from any heating-up push about this burst. Best-effort
    from the client's point of view: the result is returned but nothing is revalidated, since
    nothing on the market page itself changes. */
export async function markMarketCommentsRead(marketId: string): Promise<ActionResult<null>> {
  const supabase = await createClient();
  const result = await runRpc<null>(await supabase.rpc('mark_market_comments_read', { p_market_id: marketId }));
  if (result.error) return result;
  return { data: null };
}
