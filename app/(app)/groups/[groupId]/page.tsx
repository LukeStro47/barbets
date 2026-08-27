import Link from 'next/link';
import Image from 'next/image';
import { createClient, requireUser } from '@/lib/supabase/server';
import { notFoundIfEmpty } from '@/lib/errors';
import { getActiveMarkets, getSettledMarkets } from '@/lib/groupFeed';
import { GroupDeletionBanner } from '@/components/groups/GroupDeletionBanner';
import { GroupMarketSections } from '@/components/groups/GroupMarketSections';
import { SaveBalanceSnapshot } from '@/components/groups/SaveBalanceSnapshot';
import { PendingBonusPoolNote } from '@/components/groups/PendingBonusPoolNote';
import { OpenSeasonBettingButton } from '@/components/groups/IntermissionActions';
import { WaitingOnYouCard } from '@/components/groups/WaitingOnYouCard';
import { InvitePill } from '@/components/groups/InvitePill';
import { SeasonRecapHero, type FinalBalanceRow } from '@/components/groups/SeasonRecapHero';
import { SeasonSetupCard } from '@/components/groups/SeasonSetupCard';
import type { RosterMember } from '@/components/groups/SeasonSetupEditSheet';
import { FinalTableCard } from '@/components/groups/FinalTableCard';
import { SeasonMarketsArchiveCard } from '@/components/groups/SeasonMarketsArchiveCard';
import { SeasonNumbersCard } from '@/components/groups/SeasonNumbersCard';
import { SeasonHighlightsCard, type SnapshotHighlight } from '@/components/groups/SeasonHighlightsCard';
import { MemberTitleCard } from '@/components/groups/MemberTitleCard';
import { WhatsNextCard } from '@/components/groups/WhatsNextCard';
import { WindingDownCard } from '@/components/groups/WindingDownCard';
import { Mention } from '@/components/ui/Mention';
import { GroupAvatar } from '@/components/ui/GroupAvatar';
import { CountdownTimer } from '@/components/ui/CountdownTimer';
import { SettingsIcon, InfoIcon } from '@/components/ui/icons';
import { formatTokens } from '@/lib/formatNumber';
import { getGroupTasks } from '@/lib/tasks';
import { TITLE_ORDER, TITLE_META, type GroupTitleRow } from '@/lib/titles';
import { diffTitleSnapshots, type TitleSnapshotEntry } from '@/lib/seasonTitleDiff';
import type { GroupSettings } from '@/lib/actions/groups';

// 44px, a real tap target rather than a decorative chip — it's the only control in this header
// now that "My bets" has gone, and it's the way into everything about the group.
const iconLinkClass =
  'flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-espresso-50 text-espresso-500 transition-colors hover:bg-espresso-100 hover:text-espresso-700 active:scale-[0.92]';

/** "Nov 3 – Feb 2" — used only by the season-over recap hero's date range. */
function formatSeasonDate(iso: string): string {
  const d = new Date(iso);
  return `${d.toLocaleDateString('en-US', { month: 'short' })} ${d.getDate()}`;
}

function GroupHeader({ groupId, group, isOwner }: { groupId: string; group: { name: string; avatar_key: string | null }; isOwner: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-2.5">
        {group.avatar_key && <GroupAvatar name={group.name} avatarKey={group.avatar_key} className="h-9 w-9" />}
        <h1 className="min-w-0 font-display text-[29px] font-bold tracking-[-0.02em] text-espresso-950">{group.name}</h1>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Link href={`/groups/${groupId}/settings`} className={iconLinkClass} aria-label={isOwner ? 'Settings' : 'Group info'}>
          {isOwner ? <SettingsIcon className="h-5 w-5" /> : <InfoIcon className="h-5 w-5" />}
        </Link>
      </div>
    </div>
  );
}

export default async function GroupFeedPage({ params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await params;
  const supabase = await createClient();

  const { data: group } = await supabase
    .from('groups')
    .select('id, name, avatar_key, invite_code, owner_id, deletion_scheduled_at, pending_bonus_pool')
    .eq('id', groupId)
    .single();
  notFoundIfEmpty(group);

  const user = await requireUser(supabase);
  const isOwner = group!.owner_id === user?.id;

  const [{ data: membership }, { data: settings }] = await Promise.all([
    supabase.from('memberships').select('balance, nickname').eq('group_id', groupId).eq('user_id', user.id).single(),
    supabase.from('group_settings').select('seasons_enabled, season_length, betting_enabled, seed_amount').eq('group_id', groupId).single(),
  ]);

  const { data: season } = settings?.seasons_enabled
    ? await supabase
        .from('seasons')
        .select('id, number, status, started_at, ends_at, betting_open, name')
        .eq('group_id', groupId)
        .order('number', { ascending: false })
        .limit(1)
        .single()
    : { data: null };

  // ---------------------------------------------------------------------
  // Between seasons: every market is already settled, so this branch skips
  // the open/pending/settled feed entirely and renders the recap instead.
  // ---------------------------------------------------------------------
  if (season?.status === 'intermission') {
    const [{ data: endedResult }, { data: rosterRows }, { data: optouts }, { data: optins }, { data: titleRows }] = await Promise.all([
      supabase
        .from('season_results')
        .select('snapshot, seasons(id, number, name, started_at, ended_at, seed_amount)')
        .eq('group_id', groupId)
        .order('created_at', { ascending: false })
        .limit(1)
        .single(),
      supabase.from('memberships').select('user_id, nickname, status').eq('group_id', groupId).in('status', ['active', 'dormant']),
      supabase.from('season_optouts').select('user_id').eq('season_id', season.id),
      supabase.from('season_optins').select('user_id').eq('season_id', season.id),
      supabase.from('group_titles').select('title_key, user_id, stat_value, label, icon_key').eq('group_id', groupId),
    ]);
    notFoundIfEmpty(endedResult);

    const endedSeason = endedResult!.seasons as unknown as {
      id: string;
      number: number;
      name: string | null;
      started_at: string;
      ended_at: string | null;
      seed_amount: number | null;
    };
    const snapshot = endedResult!.snapshot as {
      champion: FinalBalanceRow | null;
      final_balances: FinalBalanceRow[];
      biggest_single_win: (SnapshotHighlight & { amount: number }) | null;
      worst_beat: (SnapshotHighlight & { amount: number }) | null;
      biggest_upset: (SnapshotHighlight & { multiple: number }) | null;
      markets_settled: number;
      tokens_wagered: number;
      bets_placed: number;
      titles_snapshot: TitleSnapshotEntry[];
    };

    const { data: priorResult } =
      endedSeason.number - 1 > 0
        ? await supabase
            .from('season_results')
            .select('snapshot, seasons!inner(number)')
            .eq('group_id', groupId)
            .eq('seasons.number', endedSeason.number - 1)
            .maybeSingle()
        : { data: null };
    const priorTitlesSnapshot = ((priorResult?.snapshot as { titles_snapshot?: TitleSnapshotEntry[] } | undefined)?.titles_snapshot ??
      null) as TitleSnapshotEntry[] | null;
    const titleChanges = diffTitleSnapshots(snapshot.titles_snapshot ?? [], priorTitlesSnapshot);

    const optedOutIds = new Set((optouts ?? []).map((o) => o.user_id));
    const optedInIds = new Set((optins ?? []).map((o) => o.user_id));
    const roster = rosterRows ?? [];
    const playing = roster.filter((m) => (m.status === 'active' && !optedOutIds.has(m.user_id)) || (m.status === 'dormant' && optedInIds.has(m.user_id)));
    const sittingOut = roster.filter((m) => !playing.some((p) => p.user_id === m.user_id));
    const mine = roster.find((m) => m.user_id === user.id);
    const ownerNickname = roster.find((m) => m.user_id === group!.owner_id)?.nickname ?? '';

    const finalBalances = snapshot.final_balances ?? [];
    const seasonName = endedSeason.name ?? `Season ${endedSeason.number}`;
    const dateRange = endedSeason.ended_at
      ? `${formatSeasonDate(endedSeason.started_at)} – ${formatSeasonDate(endedSeason.ended_at)}`
      : formatSeasonDate(endedSeason.started_at);

    const myTitles = ((titleRows ?? []) as GroupTitleRow[]).filter((r) => r.user_id === user.id);
    const myFirstTitle = TITLE_ORDER.map((k) => myTitles.find((r) => r.title_key === k)).find((r): r is GroupTitleRow => !!r);

    let viewerNet: number | undefined;
    let viewerAccuracy: number | null | undefined;
    let viewerBetCount: number | undefined;
    if (!isOwner) {
      const you = finalBalances.find((m) => m.user_id === user.id);
      viewerNet = (you?.balance ?? 0) - (endedSeason.seed_amount ?? 0);

      const { data: mySeasonBets } = await supabase
        .from('bets')
        .select('market_id, side, option_id, markets!inner(season_id, status, outcome, outcome_option_id)')
        .eq('user_id', user.id)
        .eq('markets.season_id', endedSeason.id);
      const betRows = (mySeasonBets ?? []) as any[];
      viewerBetCount = new Set(betRows.map((b) => b.market_id)).size;
      const resolvedBets = betRows.filter((b) => b.markets.status === 'resolved');
      const correctCount = resolvedBets.filter((b) => (b.option_id ? b.option_id === b.markets.outcome_option_id : b.side === b.markets.outcome)).length;
      viewerAccuracy = resolvedBets.length > 0 ? Math.round((correctCount / resolvedBets.length) * 100) : null;
    } else {
      const { count } = await supabase
        .from('bets')
        .select('id, markets!inner(season_id)', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .eq('markets.season_id', endedSeason.id);
      viewerBetCount = count ?? undefined;
    }

    const sittingOutLabel =
      sittingOut.length === 0 ? null : sittingOut.length === 1 ? `@${sittingOut[0].nickname} out` : `${sittingOut.length} out`;

    let fullSettings: GroupSettings | null = null;
    let rosterMembers: RosterMember[] = [];
    if (isOwner) {
      const { data } = await supabase.from('group_settings').select('*').eq('group_id', groupId).single();
      fullSettings = data as GroupSettings;
      rosterMembers = roster.map((m) => ({
        userId: m.user_id,
        nickname: m.nickname ?? '',
        status: m.status as 'active' | 'dormant',
        isOwner: m.user_id === group!.owner_id,
      }));
    }

    return (
      <main className="mx-auto max-w-lg px-5 pt-[22px] pb-[110px]">
        <GroupHeader groupId={groupId} group={group!} isOwner={isOwner} />

        <div className="mt-[18px] flex flex-col gap-4">
          {group!.deletion_scheduled_at && (
            <GroupDeletionBanner groupId={groupId} deletionScheduledAt={group!.deletion_scheduled_at} isOwner={isOwner} />
          )}

          <SeasonRecapHero
            viewer={isOwner ? 'owner' : 'member'}
            seasonName={seasonName}
            dateRange={dateRange}
            marketsSettled={snapshot.markets_settled ?? 0}
            finalBalances={finalBalances}
            viewerUserId={user.id}
            viewerNet={viewerNet}
            viewerAccuracy={viewerAccuracy}
            viewerTitlesHeld={myTitles.length}
          />

          {isOwner && fullSettings ? (
            <SeasonSetupCard
              groupId={groupId}
              seasonId={season.id}
              nextSeasonNumber={season.number}
              seasonName={season.name}
              settings={fullSettings}
              members={rosterMembers}
              playingCount={playing.length}
              sittingOutLabel={sittingOutLabel}
            />
          ) : (
            <>
              {myFirstTitle && (
                <MemberTitleCard
                  titleKey={myFirstTitle.title_key}
                  label={myFirstTitle.label ?? TITLE_META[myFirstTitle.title_key].label}
                  iconKey={myFirstTitle.icon_key ?? TITLE_META[myFirstTitle.title_key].defaultIconKey}
                  statValue={myFirstTitle.stat_value}
                  otherCount={myTitles.length - 1}
                />
              )}
              {mine && (
                <WhatsNextCard
                  groupId={groupId}
                  seasonId={season.id}
                  ownerNickname={ownerNickname}
                  reseedAmount={settings?.seed_amount ?? null}
                  playingCount={playing.length}
                  sittingOutNicknames={sittingOut.map((m) => m.nickname ?? '')}
                  membershipStatus={mine.status as 'active' | 'dormant'}
                  hasOptedOut={optedOutIds.has(mine.user_id)}
                  hasOptedIn={optedInIds.has(mine.user_id)}
                />
              )}
            </>
          )}

          <FinalTableCard groupId={groupId} finalBalances={finalBalances} viewerUserId={user.id} />

          {isOwner && (
            <SeasonNumbersCard
              marketsSettled={snapshot.markets_settled ?? 0}
              tokensWagered={snapshot.tokens_wagered ?? 0}
              betsPlaced={snapshot.bets_placed ?? 0}
            />
          )}

          <SeasonHighlightsCard
            groupId={groupId}
            biggestSingleWin={snapshot.biggest_single_win}
            biggestUpset={snapshot.biggest_upset}
            titleChanges={titleChanges}
          />

          <SeasonMarketsArchiveCard
            groupId={groupId}
            seasonNumber={endedSeason.number}
            marketsSettled={snapshot.markets_settled ?? 0}
            viewerBetCount={viewerBetCount}
            hasEarlierSeasons={endedSeason.number > 1}
          />
        </div>
      </main>
    );
  }

  // ---------------------------------------------------------------------
  // Active, winding_down, or seasons-off: today's shape, with the flat
  // winding-down notice replaced by WindingDownCard.
  // ---------------------------------------------------------------------
  const { tasks } = await getGroupTasks(supabase, groupId, user.id);
  // Scoped to the current season once seasons are on, so a market settled before the season
  // changed doesn't linger in the Settled tab after the fact — it's still reachable, just from
  // the intermission recap's season archive instead (see SeasonMarketsArchiveCard/`/seasons`).
  const [{ buckets, pendingTokens }, settledPage] = await Promise.all([
    getActiveMarkets(supabase, groupId, user.id),
    getSettledMarkets(supabase, groupId, user.id, null, season?.id),
  ]);

  let windingDown: React.ReactNode = null;
  if (season?.status === 'winding_down') {
    const { data: standings } = await supabase
      .from('memberships')
      .select('user_id, balance')
      .eq('group_id', groupId)
      .eq('status', 'active')
      .order('balance', { ascending: false });
    const rows = standings ?? [];
    const leader = rows[0];
    const you = rows.find((m) => m.user_id === user.id);
    const yourRank = you ? rows.findIndex((m) => m.user_id === user.id) + 1 : null;
    const youLead = !!you && yourRank === 1;
    const gapValue = youLead ? (leader?.balance ?? 0) - (rows[1]?.balance ?? leader?.balance ?? 0) : Math.max(0, (leader?.balance ?? 0) - (you?.balance ?? 0));

    windingDown = (
      <WindingDownCard
        groupId={groupId}
        seasonName={season.name ?? `Season ${season.number}`}
        yourRank={yourRank}
        totalPlayers={rows.length}
        yourBalance={you?.balance ?? 0}
        youLead={youLead}
        gapValue={gapValue}
        stillResolving={[...buckets.awaiting_resolution, ...buckets.challenged]}
      />
    );
  }

  return (
    <main className="mx-auto max-w-lg px-5 py-[22px]">
      <SaveBalanceSnapshot groupId={groupId} groupName={group!.name} balance={membership?.balance ?? 0} />
      <div className="flex flex-col gap-1.5">
        <GroupHeader groupId={groupId} group={group!} isOwner={isOwner} />
        {season && season.status === 'active' && (
          <div className="flex items-center gap-2 text-[13px] font-medium text-espresso-400">
            <span>{season.name ?? `Season ${season.number}`}</span>
            {season.ends_at && (
              <>
                <span className="h-1 w-1 shrink-0 rounded-full bg-espresso-300" />
                <CountdownTimer target={season.ends_at} prefix="Ends in" />
              </>
            )}
          </div>
        )}
        {season && season.status === 'active' && !season.betting_open && isOwner && (
          <OpenSeasonBettingButton groupId={groupId} seasonId={season.id} />
        )}
      </div>

      <div className="mt-[18px] flex flex-col gap-[18px] pb-10">
        {group!.deletion_scheduled_at && (
          <GroupDeletionBanner groupId={groupId} deletionScheduledAt={group!.deletion_scheduled_at} isOwner={isOwner} />
        )}

        <div className="relative overflow-hidden rounded-[24px] bg-gradient-to-br from-espresso-900 to-espresso-700 px-5 py-[18px]">
          <Image
            src="/barbets-mono-white.png"
            alt=""
            width={96}
            height={96}
            className="pointer-events-none absolute -top-4 -right-4 rotate-[-10deg] opacity-[0.12]"
          />
          {/* In play sits under the free-to-bet total rather than off to its right: reading down
              from the headline number to "and this much is already committed" tells that story
              better than two unrelated figures competing for the same line. It's informational
              only, not subtracted from the headline above — place_bet already deducts a bet's
              stake from memberships.balance the instant it's placed (see the money rules in
              ARCHITECTURE.md), so `balance` is already exactly what's free to bet; subtracting
              pendingTokens from it here double-counted every open stake. */}
          <div className="relative">
            <p className="text-[10.5px] font-bold tracking-[0.12em] text-honey-400 uppercase">Free to bet</p>
            <p className="mt-0.5 font-display text-[38px] leading-none font-extrabold tracking-[-0.02em] text-paper-white">
              {formatTokens(membership?.balance ?? 0)}
            </p>
            {pendingTokens > 0 && (
              <p className="mt-2 flex items-baseline gap-1.5 text-[13px] font-semibold text-paper-white/45">
                <span className="text-[10.5px] font-bold tracking-[0.12em] uppercase">In play</span>
                <span className="text-[15px] font-bold text-honey-200">{formatTokens(pendingTokens)}</span>
              </p>
            )}
          </div>
          <div className="relative mt-3.5 flex items-center justify-between border-t border-white/10 pt-3">
            {membership?.nickname && (
              <p className="text-[13px] text-espresso-200">
                Playing as <Mention nickname={membership.nickname} className="text-honey-200" />
              </p>
            )}
            <InvitePill inviteCode={group!.invite_code} />
          </div>
        </div>

        <WaitingOnYouCard groupId={groupId} tasks={tasks} />

        {group!.pending_bonus_pool > 0 && <PendingBonusPoolNote amount={group!.pending_bonus_pool} />}

        {windingDown}

        <GroupMarketSections
          groupId={groupId}
          pendingSponsor={buckets.pending_sponsor}
          open={buckets.open}
          awaitingResolution={buckets.awaiting_resolution}
          challenged={buckets.challenged}
          revealed={settledPage.markets}
          revealedNextCursor={settledPage.nextCursor}
          seasonId={season?.id}
        />
      </div>
    </main>
  );
}
