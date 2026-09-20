import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient, requireUser } from '@/lib/supabase/server';
import { PageHeader } from '@/components/ui/PageHeader';
import { EmptyState } from '@/components/ui/EmptyState';
import { Button } from '@/components/ui/Button';
import { InviteCodeBoxes } from '@/components/groups/InviteCodeBoxes';
import { StartGroupButton } from '@/components/groups/StartGroupButton';
import { DiscoverGroupCard } from '@/components/groups/DiscoverGroupCard';
import { PublicGroupsShelfRow } from '@/components/groups/PublicGroupsShelfRow';
import { ChevronRightIcon } from '@/components/ui/icons';
import { cn } from '@/lib/cn';
import { formatSignedTokens, formatOrdinal, numberWordCapitalized } from '@/lib/formatNumber';
import { GroupAvatar } from '@/components/ui/GroupAvatar';
import { getGroupTaskCounts } from '@/lib/tasks';
import { listPublicGroups } from '@/lib/actions/discover';
import { isHomeSurfacePublicGroup } from '@/lib/publicGroups';

export default async function GroupsHubPage({ searchParams }: { searchParams: Promise<{ all?: string }> }) {
  const { all } = await searchParams;
  const supabase = await createClient();
  const user = await requireUser(supabase);
  const { data: groups } = await supabase
    .from('groups')
    .select('id, name, avatar_key, deletion_scheduled_at, is_public, memberships(user_id, balance, status)')
    .order('created_at', { ascending: false });

  // Net tokens per group — same definition the leaderboard page's "All-time net" card uses
  // (every ledger entry except the seed itself, so reseeding for a new season doesn't count as
  // "winning" tokens back). One row per group from membership_ledger_net, rather than every
  // ledger row the viewer has ever had across every group summed here: this page renders one
  // figure per card, and the raw rows behind it grow for the life of the group.
  const { data: netRows } = await supabase.from('membership_ledger_net').select('group_id, net').eq('user_id', user.id);
  const netByGroup = new Map<string, number>((netRows ?? []).map((r: { group_id: string; net: number }) => [r.group_id, Number(r.net)]));

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
  // list. Public groups sink beneath the ones you actually started or were invited to as well
  // (a directory join is a lighter commitment than a real friend group), but still above the
  // between-seasons partition below, since a public group never has one. A stable sort (native
  // Array#sort in every engine this app ships to) preserves the existing newest-first order
  // within each of the resulting partitions.
  const sortedGroups = [...(groups ?? [])].sort((a, b) => {
    const intermissionDelta = (intermissionGroupIds.has(a.id) ? 1 : 0) - (intermissionGroupIds.has(b.id) ? 1 : 0);
    if (intermissionDelta !== 0) return intermissionDelta;
    return (a.is_public ? 1 : 0) - (b.is_public ? 1 : 0);
  });

  const hasGroups = (groups ?? []).length > 0;

  // The "Open to anyone" section (2A, zero-group user) / collapsed shelf row (2B, everyone
  // else) — both scoped to the sports pipeline groups only, never 'campus'. See
  // isHomeSurfacePublicGroup() for why.
  const publicGroupsResult = await listPublicGroups();
  const homeSurfacePublicGroups = (publicGroupsResult.data ?? []).filter(isHomeSurfacePublicGroup);
  const hasPublicGroups = homeSurfacePublicGroups.length > 0;
  const totalPublicOpenMarkets = homeSurfacePublicGroups.reduce((sum, g) => sum + g.open_market_count, 0);

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
      `${numberWordCapitalized(groupsWantingYou)} want${groupsWantingYou === 1 ? 's' : ''} something from you`,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <main className="mx-auto max-w-[430px] space-y-[13px] px-[18px] py-8">
      <PageHeader
        title="Your groups"
        subtitle={hasGroups ? <span className="text-[12.5px] text-faint">{headerCaption}</span> : undefined}
      />

      {!hasGroups ? (
        hasPublicGroups ? (
          <div className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between gap-3 px-0.5">
              <p className="text-[11.5px] font-bold tracking-[0.1em] text-faint uppercase">Open to anyone</p>
              <span className="text-[11.5px] font-bold text-signal">No code needed</span>
            </div>
            <div className="flex flex-col gap-[9px]">
              {homeSurfacePublicGroups.slice(0, 2).map((g) => (
                <DiscoverGroupCard
                  key={g.id}
                  variant="compact"
                  groupId={g.id}
                  name={g.name}
                  avatarKey={g.avatar_key}
                  memberCount={g.member_count}
                  openMarketCount={g.open_market_count}
                  featuredMarketTitle={g.featured_market_title}
                  featuredMarketBetCount={g.featured_market_bet_count}
                />
              ))}
            </div>
            <Link
              href="/groups/discover"
              className="flex items-center justify-center gap-1.5 py-1 text-center text-[13px] font-bold text-signal"
            >
              See all public groups
              <ChevronRightIcon className="h-[11px] w-[6px]" />
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            <EmptyState
              title="No groups yet"
              subtitle="Start one, or join with a friend's invite code below."
              action={
                <Link href="/demo" className="block">
                  <Button size="lg" variant="primary" className="w-full">
                    Try a live demo
                  </Button>
                </Link>
              }
            />
          </div>
        )
      ) : (
        <>
          {activeGroups.length > 0 && (
            <div className="flex flex-col gap-[9px]">
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
                      'flex items-center gap-3 rounded-[20px] border bg-surface px-4 py-[14px]',
                      needsYou > 0 ? 'border-alert-line bg-alert-bg' : 'border-hairline'
                    )}
                  >
                    <GroupAvatar
                      name={g.name}
                      avatarKey={g.avatar_key}
                      className="h-11 w-11 text-[13px]"
                      fallbackClassName={needsYou > 0 ? 'bg-alert text-white' : 'bg-rule text-muted'}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex min-w-0 items-start gap-1.5">
                        <p className="line-clamp-2 text-[14.5px] leading-[1.2] font-bold text-ink">{g.name}</p>
                        {g.is_public && (
                          <span className="shrink-0 rounded-[8px] bg-signal-tint px-1.5 py-[1px] text-[9.5px] font-extrabold tracking-[0.04em] text-signal uppercase">
                            Public
                          </span>
                        )}
                      </span>
                      <p className="mt-[3px] flex items-center gap-1.5 text-[12.5px] text-muted">
                        {needsYou > 0 && (
                          <>
                            <span className="inline-flex items-center gap-[5px] font-bold text-alert">
                              <span className="flex h-[15px] min-w-[15px] items-center justify-center rounded-full bg-alert px-1 font-mono text-[10px] font-semibold text-white">
                                {needsYou}
                              </span>
                              need{needsYou === 1 ? 's' : ''} you
                            </span>
                            <span className="text-dash">·</span>
                          </>
                        )}
                        <span>
                          {openCount > 0 ? (
                            <>
                              <span className="font-mono text-[12.5px] font-semibold text-ink">{openCount}</span> open
                            </>
                          ) : (
                            'Nothing open right now'
                          )}
                        </span>
                      </p>
                      {g.deletion_scheduled_at && <p className="mt-0.5 text-xs font-semibold text-alert">Being deleted</p>}
                    </span>
                    <span className="shrink-0 text-right">
                      <span
                        className={cn(
                          'block font-mono text-[15px] font-semibold tracking-tight',
                          myNet >= 0 ? 'text-gain' : 'text-alert'
                        )}
                      >
                        {formatSignedTokens(myNet)}
                      </span>
                      <span className="mt-[3px] block font-mono text-[11px] font-semibold text-faint">
                        {formatOrdinal(myRank)} of {ranked.length}
                      </span>
                    </span>
                  </Link>
                );
              })}
            </div>
          )}

          {hasPublicGroups && (
            <PublicGroupsShelfRow
              groups={homeSurfacePublicGroups.map((g) => ({ name: g.name, avatarKey: g.avatar_key }))}
              totalOpenMarkets={totalPublicOpenMarkets}
            />
          )}

          {intermissionGroups.length > 0 && (
            <div className="flex flex-col gap-2">
              <p className="px-0.5 text-[11.5px] font-bold tracking-[0.1em] text-faint uppercase">Between seasons</p>
              {intermissionGroups.map((g: any) => (
                <Link
                  key={g.id}
                  href={`/groups/${g.id}`}
                  className="flex items-center gap-3 rounded-[18px] border border-hairline bg-surface px-4 py-[14px]"
                >
                  <GroupAvatar
                    name={g.name}
                    avatarKey={g.avatar_key}
                    className="h-[34px] w-[34px] text-[11.5px]"
                    fallbackClassName="bg-rule text-faint"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px] font-bold text-muted">{g.name}</span>
                    <span className="block text-[11.5px] text-faint">Season ended · champion crowned</span>
                  </span>
                  <ChevronRightIcon className="h-3 w-[7px] shrink-0 text-faint" />
                </Link>
              ))}
            </div>
          )}

          <StartGroupButton />
        </>
      )}

      <div className="rounded-[24px] bg-ink p-[18px]">
        <p className="text-[15px] font-bold text-white">Got an invite code?</p>
        <p className="mt-0.5 text-[12.5px] text-white/55">Four characters from whoever runs the group.</p>
        <div className="mt-3.5">
          <InviteCodeBoxes />
        </div>
      </div>
    </main>
  );
}
