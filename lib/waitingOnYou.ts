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

/**
 * The header's nav badge, a narrower count than totalCount(). Closed markets
 * awaiting resolution stay listed on the /inbox page (anyone eligible can
 * propose one), but they aren't a personal to-do the way an unendorsed
 * market or an uncast vote is, so they don't inflate the badge — otherwise
 * it never clears until someone else gets around to proposing, which reads
 * as a notification that never goes away no matter what you do.
 */
export function badgeCount(w: WaitingOnYou): number {
  return w.needsEndorsement.length + w.awaitingVote.length;
}

export interface WaitingOnYouGroup {
  groupId: string;
  groupName: string;
  needsEndorsement: WaitingOnYouMarket[];
  awaitingResolution: WaitingOnYouMarket[];
  awaitingVote: WaitingOnYouMarket[];
}

/** Reshapes the flat, cross-group buckets into one entry per group, so the inbox can be broken up by group instead of reading as one undifferentiated pile for anyone in more than one. */
export function groupByGroup(w: WaitingOnYou): WaitingOnYouGroup[] {
  const byGroup = new Map<string, WaitingOnYouGroup>();

  function add(m: WaitingOnYouMarket, key: 'needsEndorsement' | 'awaitingResolution' | 'awaitingVote') {
    let g = byGroup.get(m.group_id);
    if (!g) {
      g = { groupId: m.group_id, groupName: m.groups?.name ?? 'Group', needsEndorsement: [], awaitingResolution: [], awaitingVote: [] };
      byGroup.set(m.group_id, g);
    }
    g[key].push(m);
  }

  w.awaitingVote.forEach((m) => add(m, 'awaitingVote'));
  w.awaitingResolution.forEach((m) => add(m, 'awaitingResolution'));
  w.needsEndorsement.forEach((m) => add(m, 'needsEndorsement'));

  return Array.from(byGroup.values()).sort((a, b) => a.groupName.localeCompare(b.groupName));
}
