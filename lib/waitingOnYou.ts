import type { SupabaseClient } from '@supabase/supabase-js';

export interface WaitingOnYouMarket {
  id: string;
  group_id: string;
  title: string;
  status: 'pending_sponsor' | 'closed' | 'disputed';
  market_type: 'yes_no' | 'over_under' | 'multiple_choice';
  closes_at: string;
  outcome: string | null;
  creator_id: string;
  groups: { name: string } | null;
}

export interface WaitingOnYou {
  needsEndorsement: WaitingOnYouMarket[];
  awaitingResolution: WaitingOnYouMarket[];
  awaitingVote: WaitingOnYouMarket[];
}

/** Shared by the header's badge count and the /inbox page, so the two never disagree. */
export async function getWaitingOnYou(supabase: SupabaseClient, userId: string): Promise<WaitingOnYou> {
  const { data: markets } = await supabase
    .from('visible_markets')
    .select('id, group_id, title, status, market_type, closes_at, outcome, creator_id, groups(name)')
    .in('status', ['pending_sponsor', 'closed', 'disputed'])
    .order('created_at', { ascending: true });

  const all = (markets ?? []) as unknown as WaitingOnYouMarket[];
  const disputedIds = all.filter((m) => m.status === 'disputed').map((m) => m.id);

  const { data: myVotes } =
    disputedIds.length > 0 ? await supabase.from('votes').select('market_id').eq('voter_id', userId).in('market_id', disputedIds) : { data: [] };
  const votedOn = new Set((myVotes ?? []).map((v: any) => v.market_id));

  return {
    needsEndorsement: all.filter((m) => m.status === 'pending_sponsor' && m.creator_id !== userId),
    awaitingResolution: all.filter((m) => m.status === 'closed'),
    awaitingVote: all.filter((m) => m.status === 'disputed' && !votedOn.has(m.id)),
  };
}

export function totalCount(w: WaitingOnYou): number {
  return w.needsEndorsement.length + w.awaitingResolution.length + w.awaitingVote.length;
}
