'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { unwrapRpc, toActionError, runRpc, type ActionResult } from '@/lib/errors';

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

export interface ClosedOddsRow {
  side: 'yes' | 'no' | 'over' | 'under';
  pool_amount: number;
  bet_count: number;
  pool_percent: number;
}

export interface ClosedOddsOptionRow {
  option_id: string;
  label: string;
  sort_order: number;
  pool_amount: number;
  bet_count: number;
  pool_percent: number;
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

/** The sealed "🤫 N bets placed" count — safe to show while a market is open. */
export async function getOpenBetCount(marketId: string): Promise<number> {
  const supabase = await createClient();
  return unwrapRpc<number>(await supabase.rpc('get_open_bet_count', { p_market_id: marketId }));
}

/** Pool percentages per side — only resolves once the market is closed or later. yes_no/over_under only; see getClosedOddsOptions for multiple_choice. */
export async function getClosedOdds(marketId: string): Promise<ClosedOddsRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('get_closed_odds', { p_market_id: marketId });
  if (error) throw toActionError(error);
  return data as ClosedOddsRow[];
}

/** Pool percentages per option — multiple_choice markets only, once closed or later. */
export async function getClosedOddsOptions(marketId: string): Promise<ClosedOddsOptionRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('get_closed_odds_options', { p_market_id: marketId });
  if (error) throw toActionError(error);
  return data as ClosedOddsOptionRow[];
}
