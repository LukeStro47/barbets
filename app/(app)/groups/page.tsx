import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient, requireUser } from '@/lib/supabase/server';
import { PageHeader } from '@/components/ui/PageHeader';
import { EmptyState } from '@/components/ui/EmptyState';
import { Button } from '@/components/ui/Button';
import { InviteCodeBoxes } from '@/components/groups/InviteCodeBoxes';
import { OnboardingCarousel } from '@/components/groups/OnboardingCarousel';
import { StartGroupButton } from '@/components/groups/StartGroupButton';
import { ChevronRightIcon } from '@/components/ui/icons';
import { cn } from '@/lib/cn';
import { formatSignedTokens, formatOrdinal, numberWord, numberWordCapitalized } from '@/lib/formatNumber';
import { GroupAvatar } from '@/components/ui/GroupAvatar';
import { getGroupTaskCounts } from '@/lib/tasks';

export default async function GroupsHubPage({ searchParams }: { searchParams: Promise<{ all?: string }> }) {
  const { all } = await searchParams;
  const supabase = await createClient();
  const user = await requireUser(supabase);
  const { data: groups } = await supabase
    .from('groups')
    .select('id, name, avatar_key, deletion_scheduled_at, memberships(user_id, balance, status)')
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

  // A group between seasons isn't a table you can sit down at right now, so it's counted (and
  // listed) separately from the ones that are actually running.
  const activeGroups = sortedGroups.filter((g: any) => !intermissionGroupIds.has(g.id));
  const intermissionGroups = sortedGroups.filter((g: any) => intermissionGroupIds.has(g.id));
  const groupsWantingYou = activeGroups.filter((g: any) => (taskCounts.get(g.id) ?? 0) > 0).length;

  const headerCaption = [
    `${numberWordCapitalized(activeGroups.length)} ${activeGroups.length === 1 ? 'table' : 'tables'}`,
    // Dropped entirely at zero rather than rendered as "none want something from you" — an
    // all-clear stated out loud reads as a reminder that there could have been something.
    groupsWantingYou > 0 &&
      `${numberWord(groupsWantingYou)} want${groupsWantingYou === 1 ? 's' : ''} something from you`,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <main className="mx-auto max-w-lg space-y-[18px] px-5 py-8">
      <PageHeader
        title="Your groups"
        subtitle={hasGroups ? <span className="text-[12.5px] text-espresso-400">{headerCaption}</span> : undefined}
      />

      {!hasGroups ? (
        <div className="space-y-3">
          <OnboardingCarousel />
          <EmptyState title="No groups yet" subtitle="Start one, or join with a friend's invite code below." />
        </div>
      ) : (
        <>
          {activeGroups.length > 0 && (
            <div className="flex flex-col gap-2.5">
              {activeGroups.map((g: any) => {
                // Same rank definition the leaderboard page uses: currently-playing members
                // (active or dormant, i.e. not removed or left) sorted by balance descending,
                // rank = array index + 1 — no RPC/window function needed for a row badge.
                const ranked = (g.memberships ?? [])
                  .filter((m: { status: string }) => m.status === 'active' || m.status === 'dormant')
                  .sort((a: { balance: number }, b: { balance: number }) => b.balance - a.balance);
                const myIndex = ranked.findIndex((m: { user_id: string }) => m.user_id === user?.id);
                const myRank = myIndex + 1;
                const myNet = netByGroup.get(g.id) ?? 0;
                const needsYou = taskCounts.get(g.id) ?? 0;
                const openCount = openCountByGroup.get(g.id) ?? 0;

                return (
                  <Link
                    key={g.id}
                    href={`/groups/${g.id}`}
                    className={cn(
                      // The lift is the whole signal: a card asking for something sits slightly
                      // proud of the ones that aren't, without needing a second accent colour.
                      'flex items-center gap-3 rounded-[20px] border border-espresso-100 bg-paper-white p-3.5 transition-colors hover:border-espresso-200',
                      needsYou > 0 && 'shadow-sm shadow-espresso-900/5'
                    )}
                  >
                    <GroupAvatar
                      name={g.name}
                      avatarKey={g.avatar_key}
                      radiusClassName="rounded-[14px]"
                      className="h-11 w-11 text-[13px]"
                      fallbackClassName={needsYou > 0 ? 'bg-espresso-900 text-honey-300' : 'bg-espresso-50 text-espresso-500'}
                    />
                    <span className="min-w-0 flex-1">
                      <p className="truncate font-display text-[15.5px] font-extrabold tracking-[-0.01em] text-espresso-950">{g.name}</p>
                      <p className="mt-[3px] flex items-center gap-1.5 text-[12.5px] text-espresso-500">
                        {needsYou > 0 && (
                          <>
                            <span className="inline-flex items-center gap-[5px] font-extrabold text-danger-700">
                              <span className="h-1.5 w-1.5 rounded-full bg-danger-500" />
                              {needsYou} need{needsYou === 1 ? 's' : ''} you
                            </span>
                            <span className="text-espresso-200">·</span>
                          </>
                        )}
                        <span>{openCount > 0 ? `${openCount} open` : 'Nothing open right now'}</span>
                      </p>
                      {g.deletion_scheduled_at && <p className="mt-0.5 text-xs font-semibold text-danger-700">Being deleted</p>}
                    </span>
                    <span className="shrink-0 text-right">
                      <span className={cn('block text-[15px] font-extrabold tabular-nums', myNet >= 0 ? 'text-success-700' : 'text-danger-700')}>
                        {formatSignedTokens(myNet)}
                      </span>
                      <span className="mt-0.5 block text-[11px] text-espresso-400">
                        {formatOrdinal(myRank)} of {ranked.length}
                      </span>
                    </span>
                  </Link>
                );
              })}
            </div>
          )}

          {intermissionGroups.length > 0 && (
            <div className="flex flex-col gap-2">
              <p className="ml-1 text-[10.5px] font-extrabold tracking-[0.09em] text-espresso-400 uppercase">Between seasons</p>
              {intermissionGroups.map((g: any) => (
                <Link
                  key={g.id}
                  href={`/groups/${g.id}`}
                  className="flex items-center gap-[11px] rounded-2xl bg-paper-dim px-3.5 py-[11px]"
                >
                  <GroupAvatar
                    name={g.name}
                    avatarKey={g.avatar_key}
                    radiusClassName="rounded-[11px]"
                    className="h-[34px] w-[34px] text-[11.5px]"
                    fallbackClassName="bg-espresso-100 text-espresso-400"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px] font-extrabold text-espresso-700">{g.name}</span>
                    <span className="block text-[11.5px] text-espresso-400">Season ended · champion crowned</span>
                  </span>
                  <ChevronRightIcon className="h-3 w-[7px] shrink-0 text-espresso-300" />
                </Link>
              ))}
            </div>
          )}

          <StartGroupButton />
        </>
      )}

      <div className="rounded-[22px] bg-gradient-to-br from-espresso-900 to-espresso-700 p-[18px]">
        <p className="text-[15.5px] font-extrabold text-paper-white">Got an invite code?</p>
        <p className="mt-0.5 text-[12.5px] text-paper-white/55">Four characters from whoever runs the group.</p>
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
