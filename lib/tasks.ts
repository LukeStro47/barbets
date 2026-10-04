import type { createClient } from '@/lib/supabase/server';

export interface GroupTask {
  type: 'endorse' | 'vote' | 'review';
  marketId: string;
  marketTitle: string;
  /** ISO timestamp this task's window closes — sponsor deadline for endorse, vote-window close for
   *  vote, challenge-window close for review. */
  deadline: string;
}

/**
 * "Does this group need me?" — the two market states where a task is genuinely blocked on
 * *this specific viewer* taking an action, mirroring the exact eligibility every server-side
 * RPC already enforces (sponsor_market, cast_vote) so the UI never promises a task the RPC
 * would reject:
 *   - endorse: a pending_sponsor market this viewer didn't create themselves.
 *   - vote: a disputed market where the viewer isn't a hidden subject and hasn't already
 *     cast a ballot (mirrors cast_vote's own eligible-voter check in
 *     supabase/migrations/20260721130000_resolution_window_setting.sql).
 *   - review: a proposed result still inside its challenge window, for anyone
 *     challenge_resolution() would let object (not the proposer, not a hidden subject). Not
 *     strictly blocked on you (silence means it stands), but it's the one moment a wrong call
 *     can still be caught, so it belongs where people look for things waiting on them.
 * Shared by the group hub's "N waiting on you" card (full list), the all-groups page's
 * per-row "N need you" count, and BottomNav's Home-tab red dot (see ARCHITECTURE.md's note
 * that a cross-group "Inbox" aggregate was deliberately removed — this reintroduces just the
 * count/list, not a full re-homed inbox page).
 */
export async function getGroupTasks(
  supabase: Awaited<ReturnType<typeof createClient>>,
  groupId: string,
  userId: string
): Promise<{ count: number; tasks: GroupTask[] }> {
  const [{ data: sponsorRows }, { data: disputedRows }, { data: proposedRows }] = await Promise.all([
    supabase
      .from('markets')
      .select('id, title, created_at, closes_at')
      .eq('group_id', groupId)
      .eq('status', 'pending_sponsor')
      .neq('creator_id', userId),
    supabase
      .from('markets')
      .select('id, title, challenges!inner(created_at)')
      .eq('group_id', groupId)
      .eq('status', 'disputed'),
    supabase
      .from('markets')
      .select('id, title, resolution_proposals!inner(proposer_id, proposed_at)')
      .eq('group_id', groupId)
      .eq('status', 'proposed'),
  ]);

  const tasks: GroupTask[] = [];

  for (const m of sponsorRows ?? []) {
    const byAge = new Date(m.created_at).getTime() + 24 * 3_600_000;
    const byClose = new Date(m.closes_at).getTime() - 5 * 60_000;
    tasks.push({ type: 'endorse', marketId: m.id, marketTitle: m.title, deadline: new Date(Math.min(byAge, byClose)).toISOString() });
  }

  // Proposed markets ride along here too: the same subject lookup and window length apply.
  const disputedMarketIds = [...(disputedRows ?? []).map((m) => m.id), ...(proposedRows ?? []).map((m) => m.id)];
  let subjectMarketIds = new Set<string>();
  let votedMarketIds = new Set<string>();
  let resolutionWindowHours = 8;
  if (disputedMarketIds.length > 0) {
    const [{ data: subjectRows }, { data: voteRows }, { data: settings }] = await Promise.all([
      supabase.from('market_subjects').select('market_id').eq('user_id', userId).in('market_id', disputedMarketIds),
      supabase.from('votes').select('market_id').eq('voter_id', userId).in('market_id', disputedMarketIds),
      supabase.from('group_settings').select('resolution_window_hours').eq('group_id', groupId).single(),
    ]);
    subjectMarketIds = new Set((subjectRows ?? []).map((s) => s.market_id));
    votedMarketIds = new Set((voteRows ?? []).map((v) => v.market_id));
    resolutionWindowHours = settings?.resolution_window_hours ?? 8;
  }

  for (const m of disputedRows ?? []) {
    if (subjectMarketIds.has(m.id) || votedMarketIds.has(m.id)) continue;
    // challenges.market_id is unique, so PostgREST embeds it as a single object, not an array.
    // Reading it as an array silently dropped every vote task (the hub's count, the Inbox, the
    // nav dot), so accept either shape the way the proposals loop below already does.
    const rawChallenge = m.challenges as unknown as { created_at: string } | { created_at: string }[];
    const challengedAt = (Array.isArray(rawChallenge) ? rawChallenge[0] : rawChallenge)?.created_at;
    if (!challengedAt) continue;
    const deadline = new Date(challengedAt).getTime() + resolutionWindowHours * 3_600_000;
    // Same lapse check as review below: cast_vote() rejects once the window passes, even though
    // the market stays 'disputed' until expire_stale() next finalizes it.
    if (deadline <= Date.now()) continue;
    tasks.push({ type: 'vote', marketId: m.id, marketTitle: m.title, deadline: new Date(deadline).toISOString() });
  }

  for (const m of proposedRows ?? []) {
    const raw = m.resolution_proposals as unknown as { proposer_id: string; proposed_at: string } | { proposer_id: string; proposed_at: string }[];
    const p = Array.isArray(raw) ? raw[0] : raw;
    if (!p || p.proposer_id === userId || subjectMarketIds.has(m.id)) continue;
    const deadline = new Date(p.proposed_at).getTime() + resolutionWindowHours * 3_600_000;
    if (deadline <= Date.now()) continue;
    tasks.push({ type: 'review', marketId: m.id, marketTitle: m.title, deadline: new Date(deadline).toISOString() });
  }

  return { count: tasks.length, tasks };
}

/** Lighter batched form for a list of groups (all-groups page, BottomNav) — just the count per group, no task detail. */
export async function getGroupTaskCounts(
  supabase: Awaited<ReturnType<typeof createClient>>,
  groupIds: string[],
  userId: string
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  await Promise.all(
    groupIds.map(async (groupId) => {
      const { count } = await getGroupTasks(supabase, groupId, userId);
      counts.set(groupId, count);
    })
  );
  return counts;
}
