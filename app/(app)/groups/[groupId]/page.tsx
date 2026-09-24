import { createClient, requireUser } from '@/lib/supabase/server';
import { notFoundIfEmpty } from '@/lib/errors';
import { getActiveMarkets, getSettledMarkets, type SettledCursor } from '@/lib/groupFeed';
import { GroupDeletionBanner } from '@/components/groups/GroupDeletionBanner';
import { GroupMarketSections } from '@/components/groups/GroupMarketSections';
import { SaveBalanceSnapshot } from '@/components/groups/SaveBalanceSnapshot';
import { PendingBonusPoolNote } from '@/components/groups/PendingBonusPoolNote';
import { OpenSeasonBettingButton, OpenBettingButton } from '@/components/groups/IntermissionActions';
import { WaitingOnYouCard } from '@/components/groups/WaitingOnYouCard';
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
import { CountdownTimer } from '@/components/ui/CountdownTimer';
import { formatTokens, formatSignedTokens, formatOrdinal } from '@/lib/formatNumber';
import { getGroupTasks } from '@/lib/tasks';
import { getGroupBarSwitcherState } from '@/lib/groupBar';
import { GroupBar } from '@/components/layout/GroupBar';
import { cn } from '@/lib/cn';
import { TITLE_ORDER, TITLE_META, type GroupTitleRow } from '@/lib/titles';
import { diffTitleSnapshots, type TitleSnapshotEntry } from '@/lib/seasonTitleDiff';
import type { GroupSettings } from '@/lib/actions/groups';
import { PipelineGroupFeed } from '@/components/groups/PipelineGroupFeed';

export default async function GroupFeedPage({ params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await params;
  const supabase = await createClient();

  const { data: group } = await supabase
    .from('groups')
    .select('id, name, avatar_key, invite_code, owner_id, deletion_scheduled_at, pending_bonus_pool, is_public')
    .eq('id', groupId)
    .single();
  notFoundIfEmpty(group);

  const user = await requireUser(supabase);
  const isOwner = group!.owner_id === user?.id;

  const [{ data: membership }, { data: settings }, switcherState] = await Promise.all([
    supabase.from('memberships').select('id, balance, nickname').eq('group_id', groupId).eq('user_id', user.id).single(),
    supabase.from('group_settings').select('seasons_enabled, season_length, betting_enabled, seed_amount').eq('group_id', groupId).single(),
    getGroupBarSwitcherState(supabase, groupId, user.id),
  ]);
  const groupBarProps = { groupName: group!.name, avatarKey: group!.avatar_key, ...switcherState };

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
      loser: FinalBalanceRow | null;
      prize_text: string | null;
      punishment_text: string | null;
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
        <GroupBar {...groupBarProps} />

        <div className="mt-[18px] flex flex-col gap-4">
          {group!.deletion_scheduled_at && (
            <GroupDeletionBanner groupId={groupId} deletionScheduledAt={group!.deletion_scheduled_at} isOwner={isOwner} />
          )}

          <SeasonRecapHero
            viewer={isOwner ? 'owner' : 'member'}
            seasonName={seasonName}
            marketsSettled={snapshot.markets_settled ?? 0}
            finalBalances={finalBalances}
            viewerUserId={user.id}
            viewerNet={viewerNet}
            viewerAccuracy={viewerAccuracy}
            viewerTitlesHeld={myTitles.length}
            loser={snapshot.loser}
            prizeText={snapshot.prize_text}
            punishmentText={snapshot.punishment_text}
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
  const [{ buckets, pendingTokens }, settledPage, { data: standingsRows }, { data: settledBetsRows }, { data: netRow }] = await Promise.all([
    getActiveMarkets(supabase, groupId, user.id),
    getSettledMarkets(supabase, groupId, user.id, null, season?.id),
    // The 4a balance card's "2nd of 8" figure — same rank-by-balance shape the winding-down
    // card below already computes, just needed unconditionally now instead of one status only.
    supabase.from('memberships').select('user_id, balance').eq('group_id', groupId).in('status', ['active', 'dormant']).order('balance', { ascending: false }),
    // Same win-rate definition the leaderboard's Accuracy card and profile page use (void
    // markets excluded — bets_select is already own-rows-only, so this is safe under RLS).
    supabase
      .from('bets')
      .select('side, option_id, markets!inner(group_id, status, outcome, outcome_option_id)')
      .eq('user_id', user.id)
      .eq('markets.group_id', groupId)
      .eq('markets.status', 'resolved'),
    // The balance card's green delta pill — every ledger entry but the seed, same definition
    // the leaderboard's all-time card and the groups hub's per-card figure already use.
    membership ? supabase.from('membership_ledger_net').select('net').eq('membership_id', membership.id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const standings = standingsRows ?? [];
  const yourStandingRank = standings.findIndex((m) => m.user_id === user.id) + 1 || null;
  const settledBetsForAccuracy = (settledBetsRows ?? []) as unknown as { side: string | null; option_id: string | null; markets: { outcome: string | null; outcome_option_id: string | null } }[];
  const correctCount = settledBetsForAccuracy.filter((b) => (b.option_id ? b.option_id === b.markets.outcome_option_id : b.side === b.markets.outcome)).length;
  const accuracyPct = settledBetsForAccuracy.length > 0 ? Math.round((correctCount / settledBetsForAccuracy.length) * 100) : null;
  const netHere = Number((netRow as { net: number } | null)?.net ?? 0);

  // NFL/CFB get a dedicated single-featured-market feed (PipelineGroupFeed) instead of the
  // ordinary Open/Pending/Settled tabs — see that component's own doc comment. "Featured" is
  // always the most recent system market regardless of status: an open or closed-awaiting-result
  // one if there is one, else the newest settled market, so the group never falls back to an
  // empty "come back later" placeholder the moment its one market resolves.
  const isPipelineGroup = !!group!.is_public && (group!.name === 'NFL' || group!.name === 'CFB');
  let pipelineFeatured: (typeof settledPage.markets)[number] | null = null;
  let pipelineHistory: typeof settledPage.markets = [];
  if (isPipelineGroup) {
    const active = buckets.open[0] ?? buckets.awaiting_resolution[0] ?? null;
    if (active) {
      pipelineFeatured = active;
      pipelineHistory = settledPage.markets;
    } else {
      pipelineFeatured = settledPage.markets[0] ?? null;
      pipelineHistory = settledPage.markets.slice(1);
    }
  }

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
        <GroupBar {...groupBarProps} />
        {season && season.status === 'active' && (
          <div className="flex items-center gap-2 text-[13px] font-medium text-faint">
            <span>{season.name ?? `Season ${season.number}`}</span>
            {season.ends_at && (
              <>
                <span className="h-1 w-1 shrink-0 rounded-full bg-faint" />
                <CountdownTimer target={season.ends_at} prefix="Ends in" />
              </>
            )}
          </div>
        )}
      </div>

      <div className="mt-[18px] flex flex-col gap-[18px] pb-10">
        {group!.deletion_scheduled_at && (
          <GroupDeletionBanner groupId={groupId} deletionScheduledAt={group!.deletion_scheduled_at} isOwner={isOwner} />
        )}

        {/* 4a's "Free to bet" card — a light card with the balance, a net-change pill, and a
            bottom stat row (in play / standing / accuracy), replacing the old dark ink hero.
            Invite access moved to Settings (InviteHeroCard/InviteQrButton are still there in
            full) since the design doesn't carry it on the hub at all — GroupBar's switcher
            button is the hub's only header affordance now. */}
        <div className="rounded-[24px] border border-hairline bg-surface px-[18px] py-[17px] shadow-[0_1px_2px_rgba(12,16,24,0.04)]">
          <p className="text-[11.5px] font-bold tracking-[0.1em] text-faint uppercase">Free to bet</p>
          <div className="mt-1.5 flex items-end justify-between gap-3.5">
            <p className="font-mono text-[42px] leading-none font-semibold tracking-[-0.03em] text-ink">{formatTokens(membership?.balance ?? 0)}</p>
            {netHere !== 0 && (
              <span
                className={cn(
                  'inline-flex shrink-0 items-center gap-[5px] rounded-[8px] px-[9px] py-[5px] font-mono text-[13px] font-semibold',
                  netHere > 0 ? 'bg-gain-bg text-gain' : 'bg-alert-bg text-alert'
                )}
              >
                <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                  <path d={netHere > 0 ? 'M2 8.5 5 5l2 2 3-4' : 'M2 3.5 5 7l2-2 3 4'} />
                </svg>
                {formatSignedTokens(netHere)}
              </span>
            )}
          </div>
          <div className="mt-3 flex items-center gap-[9px] border-t border-rule pt-[11px] font-mono text-xs text-faint">
            {pendingTokens > 0 && (
              <>
                <span>
                  <span className="font-semibold text-ink">{formatTokens(pendingTokens)}</span> in play
                </span>
                <span className="h-[3px] w-[3px] shrink-0 rounded-full bg-dash" />
              </>
            )}
            <span>
              <span className="font-semibold text-ink">{yourStandingRank ? formatOrdinal(yourStandingRank) : '—'}</span> of {standings.length}
            </span>
            {accuracyPct != null && (
              <>
                <span className="h-[3px] w-[3px] shrink-0 rounded-full bg-dash" />
                <span>
                  <span className="font-semibold text-ink">{accuracyPct}%</span> accuracy
                </span>
              </>
            )}
          </div>
        </div>

        <WaitingOnYouCard tasks={tasks} />

        {group!.pending_bonus_pool > 0 && <PendingBonusPoolNote amount={group!.pending_bonus_pool} />}

        {windingDown}

        {season && season.status === 'active' && !season.betting_open && isOwner && (
          <OpenSeasonBettingButton groupId={groupId} seasonId={season.id} />
        )}

        {!settings?.seasons_enabled && !settings?.betting_enabled && isOwner && <OpenBettingButton groupId={groupId} />}

        {isPipelineGroup ? (
          <PipelineGroupFeed
            groupId={groupId}
            featured={pipelineFeatured}
            history={pipelineHistory}
            historyNextCursor={settledPage.nextCursor}
          />
        ) : (
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
        )}
      </div>
    </main>
  );
}
