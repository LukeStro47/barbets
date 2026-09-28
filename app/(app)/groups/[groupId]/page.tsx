import { createClient, requireUser } from '@/lib/supabase/server';
import Link from 'next/link';
import { RowChevron } from '@/components/ui/Screen';
import { notFoundIfEmpty } from '@/lib/errors';
import { getActiveMarkets, getSettledMarkets, type SettledCursor } from '@/lib/groupFeed';
import { GroupDeletionBanner } from '@/components/groups/GroupDeletionBanner';
import { GroupMarketSections } from '@/components/groups/GroupMarketSections';
import { SaveBalanceSnapshot } from '@/components/groups/SaveBalanceSnapshot';
import { PendingBonusPoolNote } from '@/components/groups/PendingBonusPoolNote';
import { OpenSeasonBettingButton, OpenBettingButton } from '@/components/groups/IntermissionActions';
import { WaitingOnYouCard } from '@/components/groups/WaitingOnYouCard';
import { SeasonSetupCard } from '@/components/groups/SeasonSetupCard';
import type { RosterMember } from '@/components/groups/SeasonSetupEditSheet';
import { WhatsNextCard } from '@/components/groups/WhatsNextCard';
import { WindingDownCard } from '@/components/groups/WindingDownCard';
import { formatTokens, formatSignedTokens, formatOrdinal } from '@/lib/formatNumber';
import { getGroupTasks } from '@/lib/tasks';
import { getGroupBarSwitcherState } from '@/lib/groupBar';
import { GroupBar } from '@/components/layout/GroupBar';
import { cn } from '@/lib/cn';
import type { GroupSettings } from '@/lib/actions/groups';
import { PipelineGroupFeed } from '@/components/groups/PipelineGroupFeed';
import { SeasonOver } from '@/components/groups/SeasonOver';
import { loadSeasonOver } from '@/lib/seasonOver';

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
    // 5n: the whole season end on one screen (see components/groups/SeasonOver.tsx), plus the
    // owner's next-season setup or a member's what-happens-next and sit-out toggle.
    const [seasonOver, { data: rosterRows }, { data: optouts }, { data: optins }] = await Promise.all([
      loadSeasonOver(supabase, groupId, user.id),
      supabase.from('memberships').select('user_id, nickname, status').eq('group_id', groupId).in('status', ['active', 'dormant']),
      supabase.from('season_optouts').select('user_id').eq('season_id', season.id),
      supabase.from('season_optins').select('user_id').eq('season_id', season.id),
    ]);
    notFoundIfEmpty(seasonOver);

    const optedOutIds = new Set((optouts ?? []).map((o) => o.user_id));
    const optedInIds = new Set((optins ?? []).map((o) => o.user_id));
    const roster = rosterRows ?? [];
    const playing = roster.filter((m) => (m.status === 'active' && !optedOutIds.has(m.user_id)) || (m.status === 'dormant' && optedInIds.has(m.user_id)));
    const sittingOut = roster.filter((m) => !playing.some((p) => p.user_id === m.user_id));
    const mine = roster.find((m) => m.user_id === user.id);
    const ownerNickname = roster.find((m) => m.user_id === group!.owner_id)?.nickname ?? '';
    const sittingOutLabel = sittingOut.length === 0 ? null : sittingOut.length === 1 ? `@${sittingOut[0].nickname} out` : `${sittingOut.length} out`;

    const avatarIds = [...new Set([...seasonOver!.finalBalances.map((r) => r.user_id), ...(seasonOver!.champion ? [seasonOver!.champion.user_id] : [])])];
    const { data: avatarRows } =
      avatarIds.length > 0 && !group!.is_public
        ? await supabase.from('users').select('id, avatar_updated_at, avatar_preset_key').in('id', avatarIds)
        : { data: [] };
    const avatars = new Map((avatarRows ?? []).map((r) => [r.id, r]));

    let setup: React.ReactNode = null;
    if (isOwner) {
      const { data } = await supabase.from('group_settings').select('*').eq('group_id', groupId).single();
      const rosterMembers: RosterMember[] = roster.map((m) => ({
        userId: m.user_id,
        nickname: m.nickname ?? '',
        status: m.status as 'active' | 'dormant',
        isOwner: m.user_id === group!.owner_id,
      }));
      setup = (
        <SeasonSetupCard
          groupId={groupId}
          seasonId={season.id}
          nextSeasonNumber={season.number}
          seasonName={season.name}
          settings={data as GroupSettings}
          members={rosterMembers}
          playingCount={playing.length}
          sittingOutLabel={sittingOutLabel}
        />
      );
    } else if (mine) {
      setup = (
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
      );
    }

    return (
      <>
        <GroupBar {...groupBarProps} />
        <main className={cn('mx-auto max-w-[430px] px-[22px] pt-6', isOwner ? 'pb-[140px]' : 'pb-10')}>
          {group!.deletion_scheduled_at && (
            <div className="mb-4">
              <GroupDeletionBanner groupId={groupId} deletionScheduledAt={group!.deletion_scheduled_at} isOwner={isOwner} />
            </div>
          )}
          <SeasonOver groupId={groupId} data={seasonOver!} viewerId={user.id} avatars={avatars} setup={setup} />
        </main>
      </>
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

  // 4a: no season line under the bar — "No date, no season detail" (4g). The season and its
  // countdown live on the leaderboard (4f).
  return (
    <>
    <GroupBar {...groupBarProps} />
    <main className="mx-auto max-w-[430px] px-[18px] pt-5">
      <SaveBalanceSnapshot groupId={groupId} groupName={group!.name} balance={membership?.balance ?? 0} />
      <div className="flex flex-col pb-10 [&>*+*]:mt-[11px]">
        {group!.deletion_scheduled_at && (
          <GroupDeletionBanner groupId={groupId} deletionScheduledAt={group!.deletion_scheduled_at} isOwner={isOwner} />
        )}

        {/* 4a's "Free to bet" card, drawn as a flat ink card so the balance is the first thing the
            eye lands on (4a draws it light; changed at the user's request). It carries a the balance, a net-change pill, and a
            bottom stat row (in play / standing / accuracy).
            Invite access moved to Settings (InviteHeroCard/InviteQrButton are still there in
            full) since the design doesn't carry it on the hub at all — GroupBar's switcher
            button is the hub's only header affordance now. */}
        <div className="rounded-[24px] bg-ink px-[18px] py-[17px]">
          <p className="text-[11.5px] font-bold tracking-[0.1em] text-faint uppercase">Free to bet</p>
          <div className="mt-1.5 flex items-end justify-between gap-3.5">
            <p className="font-mono text-[42px] leading-none font-semibold tracking-[-0.03em] text-surface">{formatTokens(membership?.balance ?? 0)}</p>
            {netHere !== 0 && (
              <span
                className={cn(
                  'inline-flex shrink-0 items-center gap-[5px] rounded-[8px] px-[9px] py-[5px] font-mono text-[13px] font-semibold',
                  netHere > 0 ? 'bg-gain text-surface' : 'bg-alert text-surface'
                )}
              >
                <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                  <path d={netHere > 0 ? 'M2 8.5 5 5l2 2 3-4' : 'M2 3.5 5 7l2-2 3 4'} />
                </svg>
                {formatSignedTokens(netHere)}
              </span>
            )}
          </div>
          <div className="mt-3 flex items-center gap-[9px] border-t border-white/10 pt-[11px] font-mono text-xs text-faint">
            <span>
              <span className="font-semibold text-surface">{formatTokens(pendingTokens)}</span> in play
            </span>
            <span className="h-[3px] w-[3px] shrink-0 rounded-full bg-white/25" />
            <span>
              <span className="font-semibold text-surface">{yourStandingRank ? formatOrdinal(yourStandingRank) : '—'}</span> of {standings.length}
            </span>
            {accuracyPct != null && (
              <>
                <span className="h-[3px] w-[3px] shrink-0 rounded-full bg-white/25" />
                <span>
                  <span className="font-semibold text-surface">{accuracyPct}%</span> accuracy
                </span>
              </>
            )}
          </div>
        </div>

        {/* While a group is still small, the code people need to get in is right here rather than
            only behind Settings. Private groups only: a public one has no code to share. */}
        {!group!.is_public && standings.length < 4 && (
          <Link
            href={`/groups/${groupId}/invite`}
            className="flex items-center gap-3 rounded-[18px] border border-hairline bg-surface px-4 py-3"
          >
            <span className="min-w-0 flex-1">
              <span className="block text-[13.5px] font-bold text-ink">Invite people</span>
              <span className="mt-px block text-[12px] text-faint">A market needs at least two people who can bet.</span>
            </span>
            <span className="shrink-0 rounded-lg border border-hairline bg-tile px-2.5 py-1 font-mono text-[13px] font-semibold tracking-[0.08em] text-ink">
              {group!.invite_code}
            </span>
            <RowChevron className="text-faint" />
          </Link>
        )}

        <WaitingOnYouCard tasks={tasks} />

        {group!.pending_bonus_pool > 0 && <PendingBonusPoolNote amount={group!.pending_bonus_pool} />}

        {windingDown}

        {season && season.status === 'active' && !season.betting_open && isOwner && (
          <OpenSeasonBettingButton groupId={groupId} seasonId={season.id} />
        )}

        {!settings?.seasons_enabled && !settings?.betting_enabled && isOwner && <OpenBettingButton groupId={groupId} />}

        <div className="!mt-[13px]">
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
      </div>
    </main>
    </>
  );
}
