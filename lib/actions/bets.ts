'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { runRpc, type ActionResult } from '@/lib/errors';

export interface Bet {
  id: string;
  market_id: string;
  user_id: string;
  side: 'yes' | 'no' | 'over' | 'under' | null;
  option_id: string | null;
  amount: number;
  payout: number | null;
  settled_at: string | null;
  created_at: string;
}

/** groupId is only used for cache revalidation — the RPC itself derives everything it needs from marketId. */
export async function placeBet(
  groupId: string,
  marketId: string,
  amount: number,
  choice: { side: NonNullable<Bet['side']> } | { optionId: string }
): Promise<ActionResult<Bet>> {
  const supabase = await createClient();
  const result = await runRpc<Bet>(
    await supabase.rpc('place_bet', {
      p_market_id: marketId,
      p_side: 'side' in choice ? choice.side : null,
      p_amount: amount,
      p_option_id: 'optionId' in choice ? choice.optionId : null,
    })
  );
  if (result.error) return result;
  revalidatePath(`/groups/${groupId}/markets/${marketId}`);
  return result;
}
