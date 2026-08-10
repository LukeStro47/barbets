import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/ui/PageHeader';
import { EmptyState } from '@/components/ui/EmptyState';
import { Button } from '@/components/ui/Button';
import { InviteCodeBoxes } from '@/components/groups/InviteCodeBoxes';
import { OnboardingCarousel } from '@/components/groups/OnboardingCarousel';
import { PlusIcon } from '@/components/ui/icons';
import { cn } from '@/lib/cn';
import { formatSignedTokens, formatOrdinal } from '@/lib/formatNumber';
import { initials } from '@/lib/initials';
import { getGroupTaskCounts } from '@/lib/tasks';

export default async function GroupsHubPage({ searchParams }: { searchParams: Promise<{ all?: string }> }) {
  const { all } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: groups } = await supabase
    .from('groups')
    .select('id, name, deletion_scheduled_at, memberships(user_id, balance, status)')
    .order('created_at', { ascending: false });

  // Net tokens per group — same definition the leaderboard page's "All-time net" card uses
  // (every ledger entry except the seed itself, so reseeding for a new season doesn't count as
  // "winning" tokens back). One query across every group the viewer's in, not one per card.
  const { data: ledgerRows } = user
    ? await supabase
        .from('ledger')
        .select('amount, memberships!inner(user_id, group_id)')
        .eq('memberships.user_id', user.id)
        .neq('reason', 'seed')
    : { data: [] };
  const netByGroup = new Map<string, number>();
  for (const row of (ledgerRows ?? []) as any[]) {
    const groupId = row.memberships.group_id;
    netByGroup.set(groupId, (netByGroup.get(groupId) ?? 0) + row.amount);
  }

  // Which groups are currently sitting in intermission — a net-tokens figure there is stale
  // (nothing's being wagered), so those cards show "Season ended" instead. Batched across every
  // group, not queried per card, same reasoning the ledger query above already uses.
  const groupIds = (groups ?? []).map((g) => g.id);
  const { data: seasonsEnabledRows } =
    groupIds.length > 0
      ? await supabase.from('group_settings').select('group_id, seasons_enabled').in('group_id', groupIds)
      : { data: [] };
  const seasonsEnabledGroupIds = (seasonsEnabledRows ?? []).filter((r) => r.seasons_enabled).map((r) => r.group_id);
  const { data: intermissionSeasonRows } =
    seasonsEnabledGroupIds.length > 0
      ? await supabase.from('seasons').select('group_id').in('group_id', seasonsEnabledGroupIds).eq('status', 'intermission')
      : { data: [] };
  const intermissionGroupIds = new Set((intermissionSeasonRows ?? []).map((r) => r.group_id));

  // "N need you" / "N open" per row — same task definition the group hub's own waiting-on-you
  // card uses, plus a plain count of currently-open markets.
  const taskCounts = user ? await getGroupTaskCounts(supabase, groupIds, user.id) : new Map<string, number>();
  const { data: openMarketRows } =
    groupIds.length > 0 ? await supabase.from('markets').select('group_id').eq('status', 'open').in('group_id', groupIds) : { data: [] };
  const openCountByGroup = new Map<string, number>();
  for (const m of openMarketRows ?? []) {
    openCountByGroup.set(m.group_id, (openCountByGroup.get(m.group_id) ?? 0) + 1);
  }

  // With exactly one group, skip straight to it — the hub is still reachable
  // via ?all=1 (e.g. to join or start a second group).
  if (!all && (groups ?? []).length === 1) {
    redirect(`/groups/${groups![0].id}`);
  }

  // Groups whose current season has ended sink to the bottom — nothing to act on there right
  // now, so they shouldn't compete with groups still being actively played for the top of the
  // list. A stable sort (native Array#sort in every engine this app ships to) preserves the
  // existing newest-first order within each partition.
  const sortedGroups = [...(groups ?? [])].sort(
    (a, b) => (intermissionGroupIds.has(a.id) ? 1 : 0) - (intermissionGroupIds.has(b.id) ? 1 : 0)
  );

  const hasGroups = (groups ?? []).length > 0;

  return (
    <main className="mx-auto max-w-lg space-y-6 px-5 py-8">
      <PageHeader title="Your groups" />

      {!hasGroups ? (
        <div className="space-y-3">
          <OnboardingCarousel />
          <EmptyState title="No groups yet" subtitle="Start one, or join with a friend's invite code below." />
        </div>
      ) : (
        <div className="space-y-3">
          <p className="ml-1 text-[11.5px] font-extrabold tracking-[0.09em] text-espresso-400 uppercase">You're in</p>
          <div className="overflow-hidden rounded-[20px] border border-espresso-100 bg-paper-white">
            {sortedGroups.map((g: any, i) => {
              // Same rank definition the leaderboard page uses: currently-playing members
              // (active or dormant, i.e. not removed or left) sorted by balance descending,
              // rank = array index + 1 — no RPC/window function needed for a row badge.
              const ranked = (g.memberships ?? [])
                .filter((m: { status: string }) => m.status === 'active' || m.status === 'dormant')
                .sort((a: { balance: number }, b: { balance: number }) => b.balance - a.balance);
              const myIndex = ranked.findIndex((m: { user_id: string }) => m.user_id === user?.id);
              const myRank = myIndex + 1;
              const myNet = netByGroup.get(g.id) ?? 0;
              const inIntermission = intermissionGroupIds.has(g.id);
              const needsYou = taskCounts.get(g.id) ?? 0;
              const openCount = openCountByGroup.get(g.id) ?? 0;
              const isLive = needsYou > 0;

              return (
                <Link
                  key={g.id}
                  href={`/groups/${g.id}`}
                  className={cn(
                    'flex items-center gap-3 px-4 py-[15px] transition-colors hover:bg-espresso-50/25',
                    i < sortedGroups.length - 1 && 'border-b border-espresso-50'
                  )}
                >
                  <span
                    className={cn(
                      'flex h-10 w-10 shrink-0 items-center justify-center rounded-[13px] text-[12.5px] font-extrabold',
                      isLive ? 'bg-espresso-900 text-honey-300' : 'bg-espresso-50 text-espresso-500'
                    )}
                  >
                    {initials(g.name)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <p className="truncate font-display text-[15.5px] font-extrabold leading-[1.25] text-espresso-950">{g.name}</p>
                    {inIntermission ? (
                      <p className="mt-0.5 text-[12.5px] text-espresso-500">Season ended</p>
                    ) : (
                      <p className="mt-0.5 flex items-center gap-1.5 text-[12.5px] text-espresso-500">
                        {needsYou > 0 && (
                          <>
                            <span className="inline-flex items-center gap-1 font-bold text-danger-700">
                              <span className="h-1.5 w-1.5 rounded-full bg-danger-500" />
                              {needsYou} need{needsYou === 1 ? 's' : ''} you
                            </span>
                            <span className="text-espresso-200">·</span>
                          </>
                        )}
                        <span>{openCount > 0 ? `${openCount} open` : 'Nothing open right now'}</span>
                      </p>
                    )}
                    {g.deletion_scheduled_at && <p className="mt-0.5 text-xs font-semibold text-danger-700">Being deleted</p>}
                  </span>
                  {!inIntermission && (
                    <span className="shrink-0 text-right">
                      <span className={cn('block text-sm font-extrabold', myNet >= 0 ? 'text-success-700' : 'text-danger-700')}>
                        {formatSignedTokens(myNet)}
                      </span>
                      <span className="mt-px block text-[11px] text-espresso-400">
                        {formatOrdinal(myRank)} of {ranked.length}
                      </span>
                    </span>
                  )}
                </Link>
              );
            })}
          </div>

          <Link
            href="/groups/new"
            className="flex items-center justify-center gap-2 rounded-full bg-espresso-900 py-3.5 text-[15px] font-extrabold text-paper-white"
          >
            <PlusIcon className="h-4 w-4 text-honey-300" />
            Start a group
          </Link>
        </div>
      )}

      <div className="rounded-[22px] bg-gradient-to-br from-espresso-900 to-espresso-700 p-[18px]">
        <p className="text-[15.5px] font-extrabold text-paper-white">Got an invite code?</p>
        <p className="mt-0.5 text-[13px] text-paper-white/55">Four characters from whoever runs the group.</p>
        <div className="mt-3.5">
          <InviteCodeBoxes />
        </div>
      </div>

      <Link href="/demo" className="block">
        <Button size="lg" variant="outline" className="w-full">
          Try a two-minute demo
        </Button>
      </Link>
    </main>
  );
}
