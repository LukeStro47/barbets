import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient, requireUser } from '@/lib/supabase/server';
import { StartGroupButton } from '@/components/groups/StartGroupButton';
import { DiscoverGroupCard } from '@/components/groups/DiscoverGroupCard';
import { PublicGroupsShelfRow } from '@/components/groups/PublicGroupsShelfRow';
import { Greeting } from '@/components/groups/Greeting';
import { GroupAvatar } from '@/components/ui/GroupAvatar';
import { UserAvatar } from '@/components/ui/UserAvatar';
import { BrandTile } from '@/components/ui/BrandMark';
import { RowChevron } from '@/components/ui/Screen';
import { CountdownTimer } from '@/components/ui/CountdownTimer';
import { cn } from '@/lib/cn';
import { formatSignedTokens, formatOrdinal, numberWordCapitalized } from '@/lib/formatNumber';
import { getGroupTasks, type GroupTask } from '@/lib/tasks';
import { listPublicGroups } from '@/lib/actions/discover';
import { isHomeSurfacePublicGroup } from '@/lib/publicGroups';

/**
 * 4q (you have groups) and 5h (you don't). 4q: the wordmark header with your own avatar, a
 * greeting, everything across your groups that needs you, your groups with net and standing,
 * the public-groups shelf, then New group / Join with code. 5h: an empty card, the two ways in
 * (start one, join with a code), then the public groups open to anyone.
 */
export default async function GroupsHubPage({ searchParams }: { searchParams: Promise<{ all?: string }> }) {
  const { all } = await searchParams;
  const supabase = await createClient();
  const user = await requireUser(supabase);
  const [{ data: groups }, { data: profile }] = await Promise.all([
    supabase
      .from('groups')
      .select('id, name, avatar_key, deletion_scheduled_at, is_public, memberships(user_id, balance, status, nickname, joined_at)')
      .order('created_at', { ascending: false }),
    supabase.from('users').select('avatar_preset_key, avatar_updated_at').eq('id', user.id).single(),
  ]);

  // With exactly one group, skip straight to it — the hub is still reachable via ?all=1.
  if (!all && (groups ?? []).length === 1) {
    redirect(`/groups/${groups![0].id}`);
  }

  const groupIds = (groups ?? []).map((g) => g.id);
  const [{ data: netRows }, { data: seasonsEnabledRows }, { data: openMarketRows }, publicGroupsResult, tasksByGroup] = await Promise.all([
    supabase.from('membership_ledger_net').select('group_id, net').eq('user_id', user.id),
    groupIds.length > 0 ? supabase.from('group_settings').select('group_id, seasons_enabled').in('group_id', groupIds) : Promise.resolve({ data: [] }),
    groupIds.length > 0 ? supabase.from('markets').select('group_id').eq('status', 'open').in('group_id', groupIds) : Promise.resolve({ data: [] }),
    listPublicGroups(),
    Promise.all(groupIds.map((id) => getGroupTasks(supabase, id, user.id).then((r) => [id, r.tasks] as const))),
  ]);
  const netByGroup = new Map<string, number>((netRows ?? []).map((r: { group_id: string; net: number }) => [r.group_id, Number(r.net)]));
  const seasonsEnabledIds = (seasonsEnabledRows ?? []).filter((r) => r.seasons_enabled).map((r) => r.group_id);
  const { data: intermissionRows } =
    seasonsEnabledIds.length > 0
      ? await supabase.from('seasons').select('group_id').in('group_id', seasonsEnabledIds).eq('status', 'intermission')
      : { data: [] };
  const intermissionIds = new Set((intermissionRows ?? []).map((r) => r.group_id));
  const openCount = new Map<string, number>();
  for (const m of openMarketRows ?? []) openCount.set(m.group_id, (openCount.get(m.group_id) ?? 0) + 1);
  const tasks = new Map<string, GroupTask[]>(tasksByGroup);

  const publicGroups = (publicGroupsResult.data ?? []).filter(isHomeSurfacePublicGroup);
  const totalPublicOpen = publicGroups.reduce((sum, g) => sum + g.open_market_count, 0);

  const avatar = (
    <Link href="/profile" aria-label="You">
      <UserAvatar
        userId={user.id}
        nickname="you"
        avatarUpdatedAt={profile?.avatar_updated_at ?? null}
        avatarPresetKey={profile?.avatar_preset_key ?? null}
        className="h-[30px] w-[30px] text-xs"
        fallbackClassName="bg-tile text-muted"
      />
    </Link>
  );

  // ── 5h: signed in, no groups ──────────────────────────────────────────────────────────────
  if ((groups ?? []).length === 0) {
    return (
      <>
        <header className="sticky top-0 z-40 -mt-[env(safe-area-inset-top)] border-b border-hairline bg-surface pt-[calc(env(safe-area-inset-top)+12px)]">
          <div className="mx-auto flex max-w-[430px] items-center gap-[11px] px-3.5 pb-[11px]">
            <span className="min-w-0 flex-1 text-[16px] font-extrabold tracking-[-0.015em] text-ink">Your groups</span>
            {avatar}
          </div>
        </header>
        <main className="mx-auto max-w-[430px] px-[22px] pt-9 pb-10">
          <div className="rounded-[24px] border border-dashed border-dash bg-surface px-[22px] py-[30px] text-center">
            <div className="mx-auto flex h-2.5 w-[132px] overflow-hidden rounded-full bg-rule">
              <span className="h-full flex-1 bg-edge" />
              <span className="h-full w-px bg-surface" />
              <span className="h-full flex-1 bg-edge" />
            </div>
            <h1 className="mt-[18px] text-[21px] leading-[1.2] font-extrabold tracking-[-0.02em] text-ink">Nothing to bet on yet</h1>
            <p className="mt-2 text-[13px] leading-[1.5] text-muted text-pretty">
              Barbets only works with people you know. Start a group, or join one you&apos;ve been told about.
            </p>
          </div>

          <div className="mt-3.5 flex flex-col gap-[9px]">
            <StartGroupButton variant="row" />
            <Link href="/join" className="flex items-center gap-3 rounded-[18px] border border-hairline bg-surface p-4">
              <span className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[11px] bg-tile text-muted">
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                  <path d="M4 12h16M14 6l6 6-6 6" />
                </svg>
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[14.5px] font-bold text-ink">Join with a code</span>
                <span className="mt-0.5 block text-[12px] text-faint">Four characters from a mate</span>
              </span>
              <RowChevron className="text-faint" />
            </Link>
          </div>

          {publicGroups.length > 0 && (
            <>
              <p className="mt-[22px] text-[10.5px] font-bold tracking-[0.1em] text-faint uppercase">Open to anyone</p>
              <p className="mt-[5px] text-[12px] leading-[1.45] text-faint">Public groups are open for anyone. Join instantly, no invite needed.</p>
              <div className="mt-2.5 flex flex-col gap-[9px]">
                {publicGroups.map((g) => (
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
            </>
          )}
        </main>
      </>
    );
  }

  // ── 4q: all groups ────────────────────────────────────────────────────────────────────────
  // Groups between seasons sink to the bottom (nothing to act on), public groups beneath the
  // ones you were actually invited to. Stable sort keeps newest-first within each.
  const sorted = [...groups!].sort((a, b) => {
    const d = (intermissionIds.has(a.id) ? 1 : 0) - (intermissionIds.has(b.id) ? 1 : 0);
    return d !== 0 ? d : (a.is_public ? 1 : 0) - (b.is_public ? 1 : 0);
  });

  const needsYou = sorted.flatMap((g) => (tasks.get(g.id) ?? []).map((t) => ({ ...t, group: g }))).sort((a, b) => new Date(a.deadline).getTime() - new Date(b.deadline).getTime());
  const groupsNeedingYou = sorted.filter((g) => (tasks.get(g.id) ?? []).length > 0).length;
  const myNickname =
    [...groups!]
      .flatMap((g) => (g.memberships ?? []).filter((m: { user_id: string }) => m.user_id === user.id))
      .sort((a: { joined_at: string }, b: { joined_at: string }) => new Date(b.joined_at).getTime() - new Date(a.joined_at).getTime())[0]?.nickname ?? 'you';
  const greetingName = myNickname.charAt(0).toUpperCase() + myNickname.slice(1);

  return (
    <>
      <header className="sticky top-0 z-40 -mt-[env(safe-area-inset-top)] border-b border-hairline bg-surface pt-[calc(env(safe-area-inset-top)+12px)]">
        <div className="mx-auto flex max-w-[430px] items-center gap-[9px] px-3.5 pb-[11px]">
          <BrandTile size={22} />
          <span className="min-w-0 flex-1 text-[16px] font-extrabold tracking-[-0.03em] text-ink">barbets</span>
          {avatar}
        </div>
      </header>
      <main className="mx-auto max-w-[430px] px-[18px] pt-5 pb-10">
        <Greeting name={greetingName} />
        <p className="mt-1.5 text-[13px] text-faint">
          {numberWordCapitalized(sorted.length)} group{sorted.length === 1 ? '' : 's'}
          {groupsNeedingYou > 0 && (
            <>
              {' · '}
              <span className="font-bold text-alert">{groupsNeedingYou} need{groupsNeedingYou === 1 ? 's' : ''} you</span>
            </>
          )}
        </p>

        {needsYou.length > 0 && (
          <div className="mt-[15px] overflow-hidden rounded-[22px] border border-alert-line bg-surface">
            <div className="flex items-center gap-2.5 border-b border-alert-line bg-alert-bg px-4 py-[11px]">
              <span className="flex h-5 w-5 items-center justify-center rounded-md bg-alert text-[11px] font-bold text-surface">{needsYou.length}</span>
              <span className="flex-1 text-[10.5px] font-bold tracking-[0.08em] text-alert uppercase">Needs you</span>
            </div>
            {needsYou.map((t) => (
              <Link
                key={`${t.group.id}:${t.marketId}:${t.type}`}
                href={`/groups/${t.group.id}/markets/${t.marketId}`}
                className="flex items-center gap-[11px] border-b border-row-rule px-4 py-3 last:border-b-0"
              >
                <GroupAvatar name={t.group.name} avatarKey={t.group.avatar_key} className="h-[26px] w-[26px] text-[9px]" fallbackClassName="bg-ink text-on-ink" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] leading-[1.35] font-bold text-ink">
                    {t.marketTitle}, {t.type === 'endorse' ? 'endorse it' : 'vote on the result'}
                  </span>
                  <span className="mt-0.5 block truncate text-[11.5px] text-faint">
                    {t.group.name} · <CountdownTimer target={t.deadline} prefix="" /> left
                  </span>
                </span>
                <span className="shrink-0 rounded-[10px] bg-signal px-[11px] py-1.5 text-[12px] font-bold text-surface">{t.type === 'endorse' ? 'Endorse' : 'Vote'}</span>
              </Link>
            ))}
          </div>
        )}

        <div className="mt-[13px] overflow-hidden rounded-[22px] border border-hairline bg-surface">
          <div className="flex items-center justify-between gap-2.5 border-b border-rule bg-wash px-4 py-[11px]">
            <span className="text-[10.5px] font-bold tracking-[0.08em] text-faint uppercase">Your groups</span>
            <span className="text-[10.5px] font-bold tracking-[0.08em] text-faint uppercase">Net · standing</span>
          </div>
          {sorted.map((g) => {
            const playing = (g.memberships ?? [])
              .filter((m: { status: string }) => m.status === 'active' || m.status === 'dormant')
              .sort((a: { balance: number }, b: { balance: number }) => b.balance - a.balance);
            const rank = playing.findIndex((m: { user_id: string }) => m.user_id === user.id) + 1;
            const net = netByGroup.get(g.id) ?? 0;
            const waiting = (tasks.get(g.id) ?? []).length;
            const open = openCount.get(g.id) ?? 0;
            const between = intermissionIds.has(g.id);
            return (
              <Link key={g.id} href={`/groups/${g.id}`} className="flex items-center gap-3 border-b border-row-rule px-4 py-[13px] last:border-b-0">
                <GroupAvatar name={g.name} avatarKey={g.avatar_key} className="h-[38px] w-[38px] text-[12px]" fallbackClassName="bg-ink text-on-ink" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14.5px] font-bold tracking-[-0.01em] text-ink">{g.name}</span>
                  <span className="mt-1 flex items-center gap-1.5">
                    {waiting > 0 && (
                      <span className="shrink-0 rounded-lg bg-alert-bg px-1.5 py-0.5 text-[10.5px] font-bold text-alert">{waiting} need you</span>
                    )}
                    <span className="min-w-0 truncate text-[11.5px] text-faint">
                      {g.deletion_scheduled_at ? 'Being deleted' : between ? 'Season ended' : open > 0 ? `${open} open` : 'Nothing open'}
                    </span>
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  <span className={cn('block font-mono text-[14px] font-semibold', net > 0 ? 'text-gain' : net < 0 ? 'text-alert' : 'text-ink')}>{formatSignedTokens(net)}</span>
                  <span className="mt-[3px] block font-mono text-[11px] text-faint">{rank > 0 ? `${formatOrdinal(rank)} / ${playing.length}` : `— / ${playing.length}`}</span>
                </span>
                <RowChevron className="text-dash" />
              </Link>
            );
          })}
        </div>

        {publicGroups.length > 0 && (
          <div className="mt-[13px]">
            <PublicGroupsShelfRow totalOpenMarkets={totalPublicOpen} />
          </div>
        )}

        <div className="mt-[13px] flex gap-[9px]">
          <StartGroupButton variant="button" />
          <Link href="/join" className="flex h-12 flex-1 items-center justify-center rounded-[14px] border border-hairline bg-surface text-[13.5px] font-bold text-ink">
            Join with code
          </Link>
        </div>
      </main>
    </>
  );
}
