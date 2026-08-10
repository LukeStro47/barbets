import type { createClient } from '@/lib/supabase/server';

export interface GroupTask {
  type: 'endorse' | 'vote';
  marketId: string;
  marketTitle: string;
  /** ISO timestamp this task's window closes — sponsor deadline for endorse, vote-window close for vote. */
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
  const [{ data: sponsorRows }, { data: disputedRows }] = await Promise.all([
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
  ]);

  const tasks: GroupTask[] = [];

  for (const m of sponsorRows ?? []) {
    const byAge = new Date(m.created_at).getTime() + 24 * 3_600_000;
    const byClose = new Date(m.closes_at).getTime() - 5 * 60_000;
    tasks.push({ type: 'endorse', marketId: m.id, marketTitle: m.title, deadline: new Date(Math.min(byAge, byClose)).toISOString() });
  }

  const disputedMarketIds = (disputedRows ?? []).map((m) => m.id);
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
    const challengedAt = (m.challenges as unknown as { created_at: string }[])[0]?.created_at;
    if (!challengedAt) continue;
    tasks.push({
      type: 'vote',
      marketId: m.id,
      marketTitle: m.title,
      deadline: new Date(new Date(challengedAt).getTime() + resolutionWindowHours * 3_600_000).toISOString(),
    });
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
