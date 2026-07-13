'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { runRpc, type ActionResult } from '@/lib/errors';

export type ReactionEmoji = 'fire' | 'laugh' | 'clown' | 'salute' | 'thumbs_up' | 'thumbs_down';

export async function reactToMarket(groupId: string, marketId: string, emoji: ReactionEmoji): Promise<ActionResult<ReactionEmoji | null>> {
  const supabase = await createClient();
  const result = await runRpc<ReactionEmoji | null>(await supabase.rpc('react_to_market', { p_market_id: marketId, p_emoji: emoji }));
  if (result.error) return result;
  revalidatePath(`/groups/${groupId}/markets/${marketId}/reveal`);
  return result;
}
