import { redirect } from 'next/navigation';
import { createClient, requireUser } from '@/lib/supabase/server';
import { cn } from '@/lib/cn';
import { notFoundIfEmpty } from '@/lib/errors';
import { ScreenHeader } from '@/components/ui/Screen';
import { CountdownTimer } from '@/components/ui/CountdownTimer';
import { PoolStrip } from '@/components/markets/PoolStrip';
import { ClosesInValue } from '@/components/markets/ClosesInValue';
import { BonusPoolValue } from '@/components/markets/BonusPoolValue';
import { computePositions, computeStakedPositions, type PositionTicketRow } from '@/components/markets/PositionPayouts';
import {
  StatusChip,
  MarketTabs,
  MarketTitleBlock,
  PositionBox,
  CriteriaCard,
  NextStepsCard,
  ClosedOddsCard,
  ClosedBetBox,
  sideTitle,
  type NextStep,
  type ClosedOddsSide,
} from '@/components/markets/MarketScreen';
import { MarketOverflowMenu } from '@/components/markets/MarketOverflowMenu';
import { EndorseActionBar } from '@/components/markets/EndorseAction';
import { MarketActions } from '@/components/markets/MarketActions';
import { ChallengeAction } from '@/components/markets/ChallengeAction';
import { ClarificationRequests, type Clarification } from '@/components/markets/ClarificationRequests';
import { ProposeResolutionCard } from '@/components/markets/ProposeResolutionCard';
import { BetslipBar } from '@/components/markets/BetslipBar';
import { BetslipProvider } from '@/components/markets/BetslipContext';
import { VouchingTicket } from '@/components/markets/VouchingTicket';
import { ProposedOutcomeTicket } from '@/components/markets/ProposedOutcomeTicket';
import { SubjectMarketPulse, type SubjectMarketPulseData } from '@/components/markets/SubjectMarketPulse';
import { CommentThread } from '@/components/markets/CommentThread';
import type { CommentRowData } from '@/components/markets/CommentRow';
import { formatTokens } from '@/lib/formatNumber';
import { formatRelativeTime } from '@/lib/formatRelativeTime';
import { formatLine, isLineFormatUnit, isPrefixedUnit } from '@/lib/units';
import type { Market, MarketOption } from '@/lib/actions/markets';
import type { ReactionEmoji } from '@/lib/reactions';
/** An unendorsed market dies at the earlier of its own close time and 24h after creation — the
 * same pair expire_stale() sweeps on, surfaced as one deadline so an endorser sees the real one. */
function endorseDeadline(market: Market): string {
  const closes = new Date(market.closes_at).getTime();
  const dayAfterCreation = new Date(market.created_at).getTime() + 24 * 3_600_000;
  return new Date(Math.min(closes, dayAfterCreation)).toISOString();
}

export default async function MarketDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ groupId: string; marketId: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { groupId, marketId } = await params;
  const { tab } = await searchParams;
  const activeTab = tab === 'comments' ? 'comments' : 'market';
  const supabase = await createClient();

  const { data: market } = await supabase.from('visible_markets').select('*').eq('id', marketId).single();

  if (!market) {
    // Not visible via the normal path — the one deliberate exception is a subject of a
    // not-yet-resolved market, who gets a content-free "pulse" view (a sealed ticket, no odds,
    // no question) instead of a flat 404. Any other reason it's empty (doesn't exist, wrong
    // group, already resolved and RLS hasn't caught up, etc.) makes this RPC raise too, so
    // `pulse` stays null and falls through to the same 404 as before.
    const [{ data: pulse }, { data: group }] = await Promise.all([
      supabase.rpc('get_subject_market_pulse', { p_market_id: marketId }).maybeSingle(),
      supabase.from('groups').select('name').eq('id', groupId).single(),
    ]);
    if (pulse) {
      return <SubjectMarketPulse groupId={groupId} groupName={group?.name ?? 'Group'} pulse={pulse as SubjectMarketPulseData} />;
    }
  }

  const marketRow = notFoundIfEmpty<Market>(market);
  const isMultipleChoice = marketRow.market_type === 'multiple_choice';

  // A settled market's Market tab is the reveal page; its Comments tab still renders here.
  if ((marketRow.status === 'resolved' || marketRow.status === 'voided') && activeTab !== 'comments') {
    redirect(`/groups/${groupId}/markets/${marketId}/reveal`);
  }

  const user = await requireUser(supabase);
  const isCreator = marketRow.creator_id === user?.id;
  const isPendingSponsor = marketRow.status === 'pending_sponsor';

  const [
    { data: membership },
    { data: subjectRows },
    { data: options },
    { data: group },
    { data: clarificationRows },
    { data: groupSettings },
    { count: tableSize },
    { count: commentCount },
  ] = await Promise.all([
    supabase.from('memberships').select('balance, role').eq('group_id', groupId).eq('user_id', user.id).single(),
    supabase.from('market_subjects').select('user_id').eq('market_id', marketId),
    isMultipleChoice
      ? supabase.from('market_options').select('id, market_id, label, sort_order').eq('market_id', marketId).order('sort_order')
      : Promise.resolve({ data: null }),
    supabase.from('groups').select('owner_id, name, is_public, avatar_key').eq('id', groupId).single(),
    supabase
      .from('resolution_clarifications')
      .select('id, requester_id, question, created_at')
      .eq('market_id', marketId)
      .order('created_at'),
    supabase.from('group_settings').select('allow_hedged_bets, seed_amount, resolution_window_hours').eq('group_id', groupId).single(),
    // Only the endorsement screen's "Table" cell needs this, so it's skipped everywhere else
    // rather than paid for on every market load.
    isPendingSponsor
      ? supabase.from('memberships').select('user_id', { count: 'exact', head: true }).eq('group_id', groupId).eq('status', 'active')
      : Promise.resolve({ count: null }),
    supabase.from('market_comments').select('id', { count: 'exact', head: true }).eq('market_id', marketId).is('deleted_at', null),
  ]);
  const isOwner = group?.owner_id === user?.id;
  const groupName = group?.name ?? 'Group';
  const resolutionWindowHours = groupSettings?.resolution_window_hours ?? 8;
  // Public groups: only mods (or the owner) can resolve a market -- see
  // supabase/migrations/20260827100000_propose_resolution_mod_gate.sql. Always true for a
  // private group, where any member can propose a resolution.
  const canResolve = !group?.is_public || isOwner || membership?.role === 'moderator';

  const subjectUserIds = (subjectRows ?? []).map((s) => s.user_id);
  const ownerIsSubject = !!group?.owner_id && subjectUserIds.includes(group.owner_id);
  const clarifications = clarificationRows ?? [];
  // Drop nulls before the `.in()` — system markets have creator_id = null, and a null in the
  // list makes PostgREST reject/empty the whole membership lookup (see the reveal page's twin).
  const namedUserIds = [
    ...new Set(
      [marketRow.creator_id, marketRow.sponsor_id, ...subjectUserIds, ...clarifications.map((c) => c.requester_id)].filter(
        (id): id is string => id != null
      )
    ),
  ];
  const { data: namedMembers } =
    namedUserIds.length > 0
      ? await supabase.from('memberships').select('user_id, nickname').eq('group_id', groupId).in('user_id', namedUserIds)
      : { data: [] };
  const nicknameByUserId = new Map((namedMembers ?? []).map((m) => [m.user_id, m.nickname]));
  const creatorNickname = nicknameByUserId.get(marketRow.creator_id);
  const sponsorNickname = marketRow.sponsor_id ? nicknameByUserId.get(marketRow.sponsor_id) : null;
  const subjectNicknames = subjectUserIds.map((userId) => nicknameByUserId.get(userId) ?? '');
  const clarificationList: Clarification[] = clarifications.map((c) => ({
    id: c.id,
    nickname: nicknameByUserId.get(c.requester_id) ?? '',
    question: c.question,
  }));

  const balance = membership?.balance ?? 0;
  const marketOptions = options as MarketOption[] | null;

  let openBetCount: number | null = null;
  let openBetVolume: number | null = null;
  let odds: { side: string; pool_amount: number; pool_percent: number; bet_count: number }[] | null = null;
  let optionOdds: { option_id: string; label: string; pool_amount: number; pool_percent: number; bet_count: number }[] | null = null;
  let proposal: {
    proposer_id: string;
    proposed_outcome: string | null;
    proposed_option_id: string | null;
    justification: string | null;
    proposed_at: string;
    photo_path: string | null;
  } | null = null;
  let challenge: { challenger_id: string; created_at: string } | null = null;
  let myBets: { side: string | null; option_id: string | null; amount: number }[] = [];
  let myVote: { outcome: string | null; voted_option_id: string | null } | null = null;

  if (!isPendingSponsor) {
    const { data: bets } = await supabase.from('bets').select('side, option_id, amount').eq('market_id', marketId).eq('user_id', user.id);
    myBets = bets ?? [];
  }
  if (marketRow.status === 'open') {
    const [{ data: countData }, { data: volumeData }] = await Promise.all([
      supabase.rpc('get_open_bet_count', { p_market_id: marketId }),
      supabase.rpc('get_open_bet_volume', { p_market_id: marketId }),
    ]);
    openBetCount = countData as number;
    openBetVolume = volumeData as number;
  }
  if (['closed', 'proposed', 'disputed'].includes(marketRow.status)) {
    if (isMultipleChoice) {
      const { data } = await supabase.rpc('get_closed_odds_options', { p_market_id: marketId });
      optionOdds = data;
    } else {
      const { data } = await supabase.rpc('get_closed_odds', { p_market_id: marketId });
      odds = data;
    }
  }
  if (['proposed', 'disputed'].includes(marketRow.status)) {
    const { data } = await supabase
      .from('resolution_proposals')
      .select('proposer_id, proposed_outcome, proposed_option_id, justification, proposed_at, photo_path')
      .eq('market_id', marketId)
      .single();
    proposal = data;
  }

  let proposerNickname: string | undefined;
  if (proposal) {
    proposerNickname = nicknameByUserId.get(proposal.proposer_id);
    if (!proposerNickname) {
      const { data: proposerMember } = await supabase
        .from('memberships')
        .select('nickname')
        .eq('group_id', groupId)
        .eq('user_id', proposal.proposer_id)
        .single();
      proposerNickname = proposerMember?.nickname;
    }
  }

  let votesCast: number | undefined;
  let eligibleVoters: number | undefined;
  if (marketRow.status === 'disputed') {
    const { data } = await supabase.from('challenges').select('challenger_id, created_at').eq('market_id', marketId).single();
    challenge = data;
    // 5k names who challenged ("Gaz challenged the call"); the challenger usually isn't among the
    // names already fetched above, so look them up on their own.
    if (data && !nicknameByUserId.has(data.challenger_id)) {
      const { data: challenger } = await supabase
        .from('memberships')
        .select('nickname')
        .eq('group_id', groupId)
        .eq('user_id', data.challenger_id)
        .maybeSingle();
      if (challenger?.nickname) nicknameByUserId.set(data.challenger_id, challenger.nickname);
    }
    const { data: vote } = await supabase
      .from('votes')
      .select('outcome, voted_option_id')
      .eq('market_id', marketId)
      .eq('voter_id', user.id)
      .maybeSingle();
    myVote = vote;

    // Mirrors cast_vote's own eligible-voter query exactly (memberships not removed, minus
    // this market's subjects) so "N of M voted" never promises a headcount the vote itself
    // wouldn't recognize.
    const [{ count: votesCount }, eligibleResult] = await Promise.all([
      supabase.from('votes').select('id', { count: 'exact', head: true }).eq('market_id', marketId),
      (() => {
        let q = supabase.from('memberships').select('user_id', { count: 'exact', head: true }).eq('group_id', groupId).neq('status', 'removed');
        if (subjectUserIds.length > 0) q = q.not('user_id', 'in', `(${subjectUserIds.join(',')})`);
        return q;
      })(),
    ]);
    votesCast = votesCount ?? 0;
    eligibleVoters = eligibleResult.count ?? 0;
  }

  const [sideA, sideB] = marketRow.market_type === 'yes_no' ? ['yes', 'no'] : ['over', 'under'];
  const closedVolume = odds
    ? odds.reduce((sum, o) => sum + o.pool_amount, 0)
    : optionOdds
      ? optionOdds.reduce((sum, o) => sum + o.pool_amount, 0)
      : null;
  const closedBetCount = odds
    ? odds.reduce((sum, o) => sum + o.bet_count, 0)
    : optionOdds
      ? optionOdds.reduce((sum, o) => sum + o.bet_count, 0)
      : null;
  const proposedOptionLabel = proposal?.proposed_option_id
    ? marketOptions?.find((o) => o.id === proposal!.proposed_option_id)?.label
    : null;
  const optionLabelById = (id: string) => marketOptions?.find((o) => o.id === id)?.label ?? '?';
  const lineLabel = marketRow.market_type === 'over_under' ? formatLine(marketRow.line, marketRow.unit) : undefined;
  // "Over 4.5" (4n) names the side with the line's number; the unit is stated once on the Line chip.
  const lineNumber =
    marketRow.market_type === 'over_under' && marketRow.line != null
      ? isLineFormatUnit(marketRow.unit) || isPrefixedUnit(marketRow.unit)
        ? (lineLabel ?? '')
        : String(marketRow.line)
      : '';
  const sideName = (side: string) => `${sideTitle(side)}${lineNumber ? ` ${lineNumber}` : ''}`;

  const isClosed = marketRow.status === 'closed';
  const isDisputed = marketRow.status === 'disputed';
  const isOpen = marketRow.status === 'open';
  const isProposed = marketRow.status === 'proposed';

  const windowLabel = resolutionWindowHours < 1 ? `${Math.round(resolutionWindowHours * 60)} minutes` : `${resolutionWindowHours} hours`;
  const payoutStep: NextStep = { title: 'The pool pays out', sub: 'Straight into your balance, and onto the leaderboard.', state: 'upcoming' };
  const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

  const kindLabel =
    marketRow.market_type === 'yes_no'
      ? 'Yes / No'
      : marketRow.market_type === 'over_under'
        ? `Over / Under · line ${lineLabel}`
        : `One of ${marketOptions?.length ?? 0} options`;

  const overflowMenu = (
    <MarketOverflowMenu groupId={groupId} marketId={marketId} isOwner={isOwner} isCreator={isCreator} ownerIsSubject={ownerIsSubject} />
  );
  const statusChip = <StatusChip label={SHORT_STATUS[marketRow.status]} tone={isOpen ? 'quiet' : 'ink'} />;
  const headerRight = (
    <span className="flex shrink-0 items-center gap-1.5">
      {isCreator && clarificationList.length > 0 && (
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-alert-bg text-[13px] font-bold text-alert" title="Needs clarification">
          !
        </span>
      )}
      {statusChip}
      {overflowMenu}
    </span>
  );
  const tabs = (active: 'market' | 'comments') => (
    <MarketTabs groupId={groupId} marketId={marketId} active={active} commentCount={commentCount ?? 0} />
  );
  const attribution = creatorNickname ? (
    <>
      Started by @{creatorNickname}
      {sponsorNickname && <> · Endorsed by @{sponsorNickname}</>}
    </>
  ) : null;

  // ── 4e: Comments ──────────────────────────────────────────────────────────────────────────
  // The question moves up into the header (muted) and the tabs ride inside it, so the thread
  // starts right under the fixed bar; the composer is pinned to the bottom edge.
  if (activeTab === 'comments') {
    const { data: commentRows } = await supabase
      .from('market_comments')
      .select('id, user_id, body, revealed_side, revealed_option_id, revealed_amount, created_at')
      .eq('market_id', marketId)
      .is('deleted_at', null)
      .order('created_at', { ascending: true });

    const comments = commentRows ?? [];
    // Who the composer's @ picker offers: current members who can see this market. While it's
    // unsettled that excludes whoever it's about (is_market_visible's rule), and the server
    // applies the same rule before notifying anyone.
    const settled = marketRow.status === 'resolved' || marketRow.status === 'voided';
    const { data: memberRows } = await supabase
      .from('memberships')
      .select('user_id, nickname')
      .eq('group_id', groupId)
      .in('status', ['active', 'dormant'])
      .order('nickname');
    const mentionable = (memberRows ?? [])
      .filter((m) => m.user_id !== user.id && (settled || !subjectUserIds.includes(m.user_id)))
      .map((m) => m.nickname as string);
    const commenterIds = [...new Set([...comments.map((c) => c.user_id), user.id])];
    const [{ data: commenterRows }, { data: commenterUsers }] = await Promise.all([
      supabase.from('memberships').select('user_id, nickname').eq('group_id', groupId).in('user_id', commenterIds),
      supabase.from('users').select('id, avatar_updated_at, avatar_preset_key').in('id', commenterIds),
    ]);
    const commenterNickname = new Map((commenterRows ?? []).map((m) => [m.user_id, m.nickname]));
    const avatarByUser = new Map((commenterUsers ?? []).map((u) => [u.id, u]));

    const commentIds = comments.map((c) => c.id);
    const { data: reactionRows } =
      commentIds.length > 0
        ? await supabase.from('comment_reactions').select('comment_id, user_id, emoji').in('comment_id', commentIds)
        : { data: [] };
    const reactionsByComment = new Map<string, { emoji: ReactionEmoji; userId: string }[]>();
    for (const r of reactionRows ?? []) {
      const list = reactionsByComment.get(r.comment_id) ?? [];
      list.push({ emoji: r.emoji as ReactionEmoji, userId: r.user_id });
      reactionsByComment.set(r.comment_id, list);
    }

    const revealedOptionLabel = (optionId: string | null) =>
      optionId ? (marketOptions?.find((o) => o.id === optionId)?.label ?? null) : null;
    const sideLabel = (side: string | null) => (side ? sideTitle(side) : null);

    const rows: CommentRowData[] = comments.map((c) => {
      const reactions = reactionsByComment.get(c.id) ?? [];
      const counts: Partial<Record<ReactionEmoji, number>> = {};
      let myReaction: ReactionEmoji | null = null;
      for (const r of reactions) {
        counts[r.emoji] = (counts[r.emoji] ?? 0) + 1;
        if (r.userId === user.id) myReaction = r.emoji;
      }
      const av = avatarByUser.get(c.user_id);
      return {
        id: c.id,
        userId: c.user_id,
        nickname: commenterNickname.get(c.user_id) ?? '?',
        avatarUpdatedAt: av?.avatar_updated_at ?? null,
        avatarPresetKey: av?.avatar_preset_key ?? null,
        body: c.body,
        createdAt: c.created_at,
        isMine: c.user_id === user.id,
        revealedLabel: sideLabel(c.revealed_side) ?? revealedOptionLabel(c.revealed_option_id),
        revealedAmount: c.revealed_amount,
        counts,
        myReaction,
      };
    });

    const alreadyRevealed = comments.some((c) => c.user_id === user.id && c.revealed_amount != null);
    const myBet = !alreadyRevealed ? myBets[0] : undefined;
    const revealable = myBet
      ? { label: sideLabel(myBet.side) ?? revealedOptionLabel(myBet.option_id) ?? '?', amount: myBet.amount }
      : null;
    const me = avatarByUser.get(user.id);

    return (
      <>
        <ScreenHeader title={marketRow.title} tone="context" href={`/groups/${groupId}`} right={headerRight}>
          <div className="px-[18px]">{tabs('comments')}</div>
        </ScreenHeader>
        <main className={cn('mx-auto max-w-[430px] px-[18px] pt-4', revealable ? 'pb-[160px]' : 'pb-[108px]')}>
          <CommentThread
            groupId={groupId}
            marketId={marketId}
            comments={rows}
            revealable={revealable}
            mentionable={mentionable}
            endorsedBy={sponsorNickname ?? null}
            me={{
              userId: user.id,
              nickname: commenterNickname.get(user.id) ?? 'you',
              avatarUpdatedAt: me?.avatar_updated_at ?? null,
              avatarPresetKey: me?.avatar_preset_key ?? null,
            }}
          />
        </main>
      </>
    );
  }

  const ownerVoidNote = ownerIsSubject
    ? "The group owner is hidden as a subject here, so only the market's creator can void it and refund every stake."
    : null;

  // ── Endorsement ───────────────────────────────────────────────────────────────────────────
  // No artboard draws this state, so it's assembled from the same pieces as 4d: the stat strip,
  // the one ticket (what you're vouching for), the steps, and the footer's one action.
  if (isPendingSponsor) {
    return (
      <>
        <ScreenHeader title={groupName} tone="context" href={`/groups/${groupId}`} right={headerRight} />
        <main className={cn('mx-auto flex max-w-[430px] flex-col gap-[11px] px-[18px] pt-[13px]', isCreator ? 'pb-10' : 'pb-[140px]')}>
          <MarketTitleBlock title={marketRow.title} subtitle={attribution} size={23} tabs={tabs('market')} />

          <PoolStrip
            className="mt-[3px]"
            cells={[
              { label: 'Endorse by', value: <CountdownTimer target={endorseDeadline(marketRow)} prefix="" />, tone: 'signal' },
              { label: 'Betting runs', value: <CountdownTimer target={marketRow.closes_at} prefix="" /> },
              { label: 'Table', value: tableSize ?? '—' },
            ]}
          />

          <VouchingTicket
            kindLabel={kindLabel}
            description={marketRow.description}
            creatorNickname={creatorNickname}
            subjectNicknames={subjectNicknames}
            options={marketOptions}
          />

          <ClarificationRequests
            groupId={groupId}
            marketId={marketId}
            status={marketRow.status}
            description={marketRow.description}
            isCreator={isCreator}
            clarifications={clarificationList}
            variant="panel"
            creatorNickname={creatorNickname}
          />

          <NextStepsCard
            heading={isCreator ? 'What happens next' : 'After you endorse'}
            steps={[
              ...(isCreator
                ? [{ title: 'Someone endorses it', sub: 'Another member has to back it before anyone can bet.', state: 'current' as const }]
                : []),
              {
                title: 'Betting opens',
                sub: (
                  <>
                    Runs for <CountdownTimer target={marketRow.closes_at} prefix="" />. Odds are set when it closes, from the final pool.
                  </>
                ),
                state: isCreator ? 'upcoming' : 'current',
              },
              { title: 'Anyone calls the result', sub: `Anyone in the group can challenge it for ${windowLabel}.`, state: 'upcoming' },
              payoutStep,
            ]}
          />

          {isCreator ? (
            <p className="text-[12px] leading-[1.5] text-faint">
              Waiting for another member to endorse this market. It expires if nobody does before betting would close, or after 24 hours, whichever comes first.
            </p>
          ) : (
            <EndorseActionBar groupId={groupId} marketId={marketId} />
          )}
        </main>
      </>
    );
  }

  // ── 4d / 4h / 4h2 / 4h3: open ─────────────────────────────────────────────────────────────
  if (isOpen) {
    const stakedRows = computeStakedPositions(myBets, optionLabelById);
    const hasPosition = stakedRows.length > 0;
    const staked = openBetVolume ?? 0;
    const hasBonus = marketRow.bonus_pool > 0;
    const pool = staked + marketRow.bonus_pool;

    const openSteps: NextStep[] = [
      {
        title: 'Betting closes',
        sub: (
          <>
            In <CountdownTimer target={marketRow.closes_at} prefix="" />. Odds are set then, from the final pool.
          </>
        ),
        state: 'current',
      },
      { title: 'Anyone calls the result', sub: `Anyone in the group can challenge it for ${windowLabel}.`, state: 'upcoming' },
      payoutStep,
    ];

    const clarifications = (
      <ClarificationRequests
        groupId={groupId}
        marketId={marketId}
        status={marketRow.status}
        description={marketRow.description}
        isCreator={isCreator}
        clarifications={clarificationList}
      />
    );

    const proposeEarly = (
      <ProposeResolutionCard
        groupId={groupId}
        market={marketRow}
        options={marketOptions}
        resolutionWindowHours={resolutionWindowHours}
        canResolve={canResolve}
      />
    );

    const betslip = (
      <BetslipBar
        groupId={groupId}
        groupName={groupName}
        groupAvatarKey={group?.avatar_key ?? null}
        market={marketRow}
        balance={balance}
        options={marketOptions}
        existingBets={myBets}
        allowHedgedBets={groupSettings?.allow_hedged_bets ?? true}
        seedAmount={groupSettings?.seed_amount ?? 1000}
        betVolume={openBetVolume}
        bonusPool={marketRow.bonus_pool}
      />
    );

    return (
      <BetslipProvider>
        <ScreenHeader title={groupName} tone="context" href={`/groups/${groupId}`} right={headerRight} />
        <main className={cn('mx-auto flex max-w-[430px] flex-col gap-[11px] px-[18px] pt-[13px]', hasPosition ? 'pb-[132px]' : 'pb-6')}>
          {hasPosition ? (
            // 4d: attribution under the title, the stat strip, the dark position box; adding to
            // the bet happens from the sticky footer BetslipBar renders in this state.
            <>
              <MarketTitleBlock title={marketRow.title} subtitle={attribution} size={23} tabs={tabs('market')} />
              <PoolStrip
                className="mt-[3px]"
                cells={
                  hasBonus
                    ? [
                        { label: 'Pool', value: formatTokens(pool), flex: 1.15 },
                        { label: 'Bonus', value: <BonusPoolValue bonusPool={marketRow.bonus_pool} staked={staked} />, tone: 'signal', highlight: true, flex: 1 },
                        { label: 'Bets', value: openBetCount ?? 0, flex: 0.85 },
                        { label: 'Closes in', value: <ClosesInValue closesAt={marketRow.closes_at} />, tone: 'signal', flex: 1.25 },
                      ]
                    : [
                        { label: 'Pool', value: formatTokens(pool) },
                        { label: 'Bets', value: openBetCount ?? 0, flex: 0.8 },
                        { label: 'Closes in', value: <ClosesInValue closesAt={marketRow.closes_at} />, tone: 'signal', flex: 1.2 },
                      ]
                }
              />
              <PositionBox rows={stakedRows} />
              <CriteriaCard label="Resolution criteria" description={marketRow.description} subjects={subjectNicknames} note={ownerVoidNote}>
                {clarifications}
              </CriteriaCard>
              <NextStepsCard steps={openSteps}>{proposeEarly}</NextStepsCard>
              {betslip}
            </>
          ) : (
            // 4h: pool and closing time fold into the line under the title; the bet card leads.
            <>
              <MarketTitleBlock
                title={marketRow.title}
                subtitle={
                  <>
                    Pool {formatTokens(pool)} · <CountdownTimer target={marketRow.closes_at} prefix="closes in" />
                    {creatorNickname && <> · started by @{creatorNickname}</>}
                  </>
                }
                tabs={tabs('market')}
              />
              <div className="mt-px">{betslip}</div>
              <CriteriaCard label="How it settles" description={marketRow.description} subjects={subjectNicknames} note={ownerVoidNote} compact>
                {clarifications}
              </CriteriaCard>
              <NextStepsCard steps={openSteps}>{proposeEarly}</NextStepsCard>
            </>
          )}
        </main>
      </BetslipProvider>
    );
  }

  // ── 4n: closed, no result yet ─────────────────────────────────────────────────────────────
  if (isClosed) {
    const positions = computePositions(myBets, odds ?? undefined, optionOdds ?? undefined);
    const mine = positions[0];
    // A fixed reading order (No/Yes, Under/Over — 4n's own left/right) rather than sorting by
    // share, so a side never swaps position as the pool moves.
    const oddsSides: ClosedOddsSide[] = odds
      ? [sideB, sideA]
          .map((s) => odds!.find((o) => o.side === s))
          .filter((o): o is NonNullable<typeof o> => !!o)
          .map((o) => ({ key: o.side, label: sideName(o.side), percent: o.pool_percent, staked: o.pool_amount }))
      : (optionOdds ?? []).map((o) => ({ key: o.option_id, label: o.label, percent: o.pool_percent, staked: o.pool_amount }));
    const minePct = mine ? oddsSides.find((s) => s.key === mine.key)?.percent : undefined;
    const mineLabel = mine ? (odds ? sideName(mine.key) : mine.label) : '';
    const mineShort = mine ? (odds ? sideTitle(mine.key) : mine.label) : '';
    const oddsNote =
      mine && minePct != null
        ? `The pool decides the price. ${mineShort} is the ${minePct < 50 ? 'less' : 'more'} popular side, so it pays ${minePct < 50 ? 'more' : 'less'}: your ${formatTokens(mine.amount)} returns ${formatTokens(mine.projected)}.`
        : 'The pool decides the price. The less popular side pays more.';
    const closedAgo = marketRow.closed_at ? formatRelativeTime(marketRow.closed_at) : 'just now';

    return (
      <>
        <ScreenHeader title={groupName} tone="context" href={`/groups/${groupId}`} right={headerRight} />
        <main className={cn('mx-auto flex max-w-[430px] flex-col gap-[11px] px-[18px] pt-[13px]', canResolve ? 'pb-[120px]' : 'pb-10')}>
          <MarketTitleBlock title={marketRow.title} subtitle={`Betting closed ${closedAgo}`} tabs={tabs('market')} />
          {mine && <div className="mt-0.5"><ClosedBetBox amount={mine.amount} label={mineLabel} pays={mine.projected} /></div>}
          <ClosedOddsCard sides={oddsSides} pool={closedVolume ?? 0} lineLabel={lineLabel} mySideKey={mine?.key} note={oddsNote} />
          <NextStepsCard
            steps={[
              { title: 'Betting closed', sub: `${capitalize(closedAgo)}. The final pool set the price above.`, state: 'done' },
              { title: 'Nobody has called it yet', sub: `Anyone in the group can. You get ${windowLabel} to challenge whatever they call.`, state: 'current' },
              payoutStep,
            ]}
          />
          <p className="mt-px text-[12.5px] leading-[1.5] text-faint text-pretty">
            <span className="font-bold text-muted">Settles on:</span> {marketRow.description}
          </p>
          <ProposeResolutionCard
            groupId={groupId}
            market={marketRow}
            options={marketOptions}
            resolutionWindowHours={resolutionWindowHours}
            canResolve={canResolve}
            trigger="footer"
          />
        </main>
      </>
    );
  }

  // ── Called, inside the challenge window ───────────────────────────────────────────────────
  if (isProposed && proposal) {
    const proposedKey = proposal.proposed_option_id ?? proposal.proposed_outcome;
    const proposedVoid = proposal.proposed_outcome === 'void';
    const rows: PositionTicketRow[] = computePositions(
      myBets,
      !isMultipleChoice ? (odds ?? undefined) : undefined,
      isMultipleChoice ? (optionOdds ?? undefined) : undefined
    ).map((p) => ({ ...p, standsToWin: proposedVoid ? undefined : p.key === proposedKey }));
    const finalAt = new Date(new Date(proposal.proposed_at).getTime() + resolutionWindowHours * 3_600_000).toISOString();
    const calledAgo = formatRelativeTime(proposal.proposed_at);

    return (
      <>
        <ScreenHeader title={groupName} tone="context" href={`/groups/${groupId}`} right={headerRight} />
        <main className="mx-auto flex max-w-[430px] flex-col gap-[11px] px-[18px] pt-[13px] pb-10">
          <MarketTitleBlock
            title={marketRow.title}
            subtitle={proposerNickname ? `Called by @${proposerNickname}, ${calledAgo}` : `Called ${calledAgo}`}
            tabs={tabs('market')}
          />
          <PoolStrip
            className="mt-[3px]"
            cells={[
              { label: 'Pool', value: formatTokens(closedVolume ?? 0) },
              { label: 'Bets', value: closedBetCount ?? 0, flex: 0.8 },
              { label: 'Final in', value: <CountdownTimer target={finalAt} prefix="" />, tone: 'signal', flex: 1.2 },
            ]}
          />
          <ProposedOutcomeTicket
            marketId={marketId}
            outcomeLabel={proposedOptionLabel ?? (proposal.proposed_outcome ? sideName(proposal.proposed_outcome) : '')}
            proposerNickname={proposerNickname}
            justification={proposal.justification}
            hasPhoto={!!proposal.photo_path}
            positionRows={rows}
            sideOdds={!isMultipleChoice ? (odds ?? undefined) : undefined}
            optionOdds={isMultipleChoice ? (optionOdds ?? undefined) : undefined}
            lineLabel={lineLabel}
          />
          <CriteriaCard label="How it settles" description={marketRow.description} compact />
          <NextStepsCard
            steps={[
              { title: proposerNickname ? `@${proposerNickname} called it` : 'The result was called', sub: `${capitalize(calledAgo)}.`, state: 'done' },
              {
                title: 'Anyone can challenge',
                sub: (
                  <>
                    For <CountdownTimer target={finalAt} prefix="" />. A challenge goes to a sealed vote.
                  </>
                ),
                state: 'current',
              },
              payoutStep,
            ]}
          >
            <ChallengeAction
              groupId={groupId}
              marketId={marketId}
              proposedAt={proposal.proposed_at}
              resolutionWindowHours={resolutionWindowHours}
              iAmProposer={proposal.proposer_id === user.id}
            />
          </NextStepsCard>
        </main>
      </>
    );
  }

  // ── 5k: challenged, the sealed ballot ─────────────────────────────────────────────────────
  return (
    <>
      <ScreenHeader title="Challenged" href={`/groups/${groupId}`} right={overflowMenu} />
      <main className="mx-auto flex max-w-[430px] flex-col px-[22px] pt-5 pb-[132px]">
        {isDisputed && (
          <MarketActions
            groupId={groupId}
            market={marketRow}
            proposal={proposal}
            challenge={challenge}
            myVote={myVote}
            currentUserId={user.id}
            proposerNickname={proposerNickname}
            challengerNickname={challenge ? nicknameByUserId.get(challenge.challenger_id) : undefined}
            options={marketOptions}
            resolutionWindowHours={resolutionWindowHours}
            votesCast={votesCast}
            eligibleVoters={eligibleVoters}
            myStake={myBets.reduce((sum, b) => sum + b.amount, 0)}
            lineNumber={lineNumber}
          />
        )}
      </main>
    </>
  );
}

/** The header chip's short form of each status (4d "Open", 4n "Closed", 4m "Settled"). */
const SHORT_STATUS: Record<Market['status'], string> = {
  pending_sponsor: 'Needs a second',
  open: 'Open',
  closed: 'Closed',
  proposed: 'Called',
  disputed: 'In dispute',
  resolved: 'Settled',
  voided: 'Void',
};
