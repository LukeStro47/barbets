'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { runRpc, type ActionResult } from '@/lib/errors';

export interface PayoutBreakdown {
  creator_cut: number;
  endorser_cut: number;
  /** Exactly one of these three is ever non-zero — which fallback fired when nobody predicted the outcome. */
  other_markets_cut: number;
  refunded_to_bettors: number;
  settled_to_owner: number;
}

export interface Market {
  id: string;
  group_id: string;
  season_id: string | null;
  title: string;
  description: string;
  market_type: 'yes_no' | 'over_under' | 'multiple_choice';
  line: number | null;
  creator_id: string;
  sponsor_id: string | null;
  closes_at: string;
  status: 'pending_sponsor' | 'open' | 'closed' | 'proposed' | 'disputed' | 'resolved' | 'voided';
  outcome: 'yes' | 'no' | 'over' | 'under' | 'void' | null;
  outcome_option_id: string | null;
  actual_value: number | null;
  closed_at: string | null;
  resolved_at: string | null;
  created_at: string;
  /** Money redistributed in from another market's universal-loss split, waiting to be absorbed into this market's own pool at finalize time. */
  bonus_pool: number;
  /** Only set when a universal-loss market resolved with distribute_payout on — see finalize_market(). */
  payout_breakdown: PayoutBreakdown | null;
}

export interface MarketOption {
  id: string;
  market_id: string;
  label: string;
  sort_order: number;
}

export async function createMarket(input: {
  groupId: string;
  title: string;
  description: string;
  marketType: 'yes_no' | 'over_under' | 'multiple_choice';
  closesAt: string;
  line?: number | null;
  subjectUserIds?: string[];
  /** multiple_choice only — each entry is either plain text, or `@nickname` to attach that member as the option's subject. */
  options?: string[];
}): Promise<ActionResult<Market>> {
  const supabase = await createClient();
  const result = await runRpc<Market>(
    await supabase.rpc('create_market', {
      p_group_id: input.groupId,
      p_title: input.title,
      p_description: input.description,
      p_market_type: input.marketType,
      p_closes_at: input.closesAt,
      p_line: input.line ?? null,
      p_subject_user_ids: input.subjectUserIds ?? [],
      p_options: input.options ?? null,
    })
  );
  if (result.error) return result;
  revalidatePath(`/groups/${input.groupId}`);
  return result;
}

export async function sponsorMarket(marketId: string): Promise<ActionResult<Market>> {
  const supabase = await createClient();
  const result = await runRpc<Market>(await supabase.rpc('sponsor_market', { p_market_id: marketId }));
  if (result.error) return result;
  revalidatePath(`/groups/${result.data!.group_id}/markets/${marketId}`);
  return result;
}
