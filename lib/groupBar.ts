import type { createClient } from '@/lib/supabase/server';
import { getGroupTaskCounts } from '@/lib/tasks';

/**
 * The two pieces of cross-group data GroupBar (components/layout/GroupBar.tsx) needs that
 * aren't already part of whatever the page itself fetches for the current group: whether the
 * viewer has anywhere else to switch to, and whether something elsewhere needs them. Shared by
 * every in-group page that renders the bar, rather than each repeating the same two-query
 * pattern with its own subtly different shape.
 */
export async function getGroupBarSwitcherState(
  supabase: Awaited<ReturnType<typeof createClient>>,
  groupId: string,
  userId: string
): Promise<{ hasOtherGroups: boolean; needsYou: boolean }> {
  const { data: otherGroupRows } = await supabase
    .from('memberships')
    .select('group_id')
    .eq('user_id', userId)
    .in('status', ['active', 'dormant'])
    .neq('group_id', groupId);
  const otherGroupIds = (otherGroupRows ?? []).map((r) => r.group_id);
  if (otherGroupIds.length === 0) return { hasOtherGroups: false, needsYou: false };
  const counts = await getGroupTaskCounts(supabase, otherGroupIds, userId);
  return { hasOtherGroups: true, needsYou: [...counts.values()].some((c) => c > 0) };
}
