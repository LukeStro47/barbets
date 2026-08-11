import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { notFoundIfEmpty } from '@/lib/errors';
import { PageHeader } from '@/components/ui/PageHeader';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { CountdownTimer } from '@/components/ui/CountdownTimer';
import { PoolStrip } from '@/components/markets/PoolStrip';
import { ClosesInValue } from '@/components/markets/ClosesInValue';
import { FinalOddsCard } from '@/components/markets/FinalOddsCard';
import {
  YourPositionCard,
  PositionTicket,
  computePositions,
  computeStakedPositions,
  type PositionTicketRow,
} from '@/components/markets/PositionPayouts';
import { SettlementCard } from '@/components/markets/SettlementCard';
import { HowItSettlesCard } from '@/components/markets/HowItSettlesCard';
import { ResolutionTimeline } from '@/components/markets/ResolutionTimeline';
import { MarketOverflowMenu } from '@/components/markets/MarketOverflowMenu';
import { EndorseActionBar } from '@/components/markets/EndorseAction';
import { MarketActions } from '@/components/markets/MarketActions';
import { ChallengeAction } from '@/components/markets/ChallengeAction';
import { ClarificationRequests, type Clarification } from '@/components/markets/ClarificationRequests';
import { ProposeResolutionCard } from '@/components/markets/ProposeResolutionCard';
import { BetslipBar } from '@/components/markets/BetslipBar';
import { BetslipProvider } from '@/components/markets/BetslipContext';
import { LineTicket, OptionsTicket } from '@/components/markets/MarketExplainer';
import { VouchingTicket } from '@/components/markets/VouchingTicket';
import { ProposedOutcomeTicket } from '@/components/markets/ProposedOutcomeTicket';
import { SubjectMarketPulse, type SubjectMarketPulseData } from '@/components/markets/SubjectMarketPulse';
import { STATUS_LABEL, STATUS_TONE } from '@/lib/marketStatus';
import { formatTokens } from '@/lib/formatNumber';
import { formatLine } from '@/lib/units';
import type { Market, MarketOption } from '@/lib/actions/markets';

/** An unendorsed market dies at the earlier of its own close time and 24h after creation — the
 * same pair expire_stale() sweeps on, surfaced as one deadline so an endorser sees the real one. */
function endorseDeadline(market: Market): string {
  const closes = new Date(market.closes_at).getTime();
  const dayAfterCreation = new Date(market.created_at).getTime() + 24 * 3_600_000;
  return new Date(Math.min(closes, dayAfterCreation)).toISOString();
}

export default async function MarketDetailPage({
  params,
}: {
  params: Promise<{ groupId: string; marketId: string }>;
}) {
  const { groupId, marketId } = await params;
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

  if (marketRow.status === 'resolved' || marketRow.status === 'voided') {
    redirect(`/groups/${groupId}/markets/${marketId}/reveal`);
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
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
  ] = await Promise.all([
    supabase.from('memberships').select('balance').eq('group_id', groupId).eq('user_id', user!.id).single(),
    supabase.from('market_subjects').select('user_id').eq('market_id', marketId),
    isMultipleChoice
      ? supabase.from('market_options').select('id, market_id, label, sort_order').eq('market_id', marketId).order('sort_order')
      : Promise.resolve({ data: null }),
    supabase.from('groups').select('owner_id, name').eq('id', groupId).single(),
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
  ]);
  const isOwner = group?.owner_id === user?.id;
  const groupName = group?.name ?? 'Group';
  const resolutionWindowHours = groupSettings?.resolution_window_hours ?? 8;

  const subjectUserIds = (subjectRows ?? []).map((s) => s.user_id);
  const ownerIsSubject = !!group?.owner_id && subjectUserIds.includes(group.owner_id);
  const clarifications = clarificationRows ?? [];
  const namedUserIds = [
    marketRow.creator_id,
    ...(marketRow.sponsor_id ? [marketRow.sponsor_id] : []),
    ...subjectUserIds,
    ...clarifications.map((c) => c.requester_id),
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
    const { data: bets } = await supabase.from('bets').select('side, option_id, amount').eq('market_id', marketId).eq('user_id', user!.id);
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
    const { data: vote } = await supabase
      .from('votes')
      .select('outcome, voted_option_id')
      .eq('market_id', marketId)
      .eq('voter_id', user!.id)
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
  const oddsA = odds?.find((o) => o.side === sideA);
  const oddsB = odds?.find((o) => o.side === sideB);
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

  const isClosed = marketRow.status === 'closed';
  const isDisputed = marketRow.status === 'disputed';
  const isOpen = marketRow.status === 'open';
  const isProposed = marketRow.status === 'proposed';

  /** The ticket header band's right-hand meta: what kind of choice this market is. Doubles as
   * the reason the explainer card can disappear once someone has a position — the line and the
   * option count both survive here. */
  const kindLabel =
    marketRow.market_type === 'yes_no'
      ? 'Yes / No'
      : marketRow.market_type === 'over_under'
        ? `Over / Under · line ${lineLabel}`
        : `One of ${marketOptions?.length ?? 0} options`;

  const overflowMenu = (
    <MarketOverflowMenu groupId={groupId} marketId={marketId} isOwner={isOwner} isCreator={isCreator} ownerIsSubject={ownerIsSubject} />
  );

  const header = (
    <PageHeader
      title={marketRow.title}
      backHref={`/groups/${groupId}`}
      backLabel={groupName}
      backAction={
        <div className="flex items-center gap-1.5">
          {isCreator && clarificationList.length > 0 && (
            <span
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-danger-100 text-sm font-bold text-danger-700"
              title="Needs clarification"
            >
              !
            </span>
          )}
          <Badge tone={STATUS_TONE[marketRow.status]}>{STATUS_LABEL[marketRow.status]}</Badge>
          {overflowMenu}
        </div>
      }
    />
  );

  const bonusPoolNote = marketRow.bonus_pool > 0 && (
    <p className="text-xs font-semibold text-espresso-400">
      Includes {formatTokens(marketRow.bonus_pool)} bonus tokens from an earlier resolution
      {marketRow.carried_bonus_pool > 0 && marketRow.carried_bonus_pool !== marketRow.bonus_pool
        ? ` (${formatTokens(marketRow.carried_bonus_pool)} carried in at creation)`
        : ''}
      .
    </p>
  );

  const ownerVoidNote =
    'The group owner can void this market at any time and refund every stake. If the owner is hidden as a subject here, the creator can void it instead.';

  // ── Endorsement (1a) ──────────────────────────────────────────────────────────────────────
  // One thing to judge, one thing to do. The creator can't endorse their own market, so they get
  // the same page without the action bar and with the full roadmap rather than "after you
  // endorse" — they're waiting on someone else, not deciding.
  if (isPendingSponsor) {
    return (
      <main className="mx-auto max-w-lg space-y-4 px-5 py-8">
        {header}

        <PoolStrip
          cells={[
            { label: 'Endorse by', value: <CountdownTimer target={endorseDeadline(marketRow)} prefix="" /> },
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

        <Card>
          <ResolutionTimeline
            resolutionWindowHours={resolutionWindowHours}
            stage={isCreator ? 'pending_sponsor' : 'endorsing'}
            bettingRunsUntil={marketRow.closes_at}
          />
        </Card>

        {isCreator ? (
          <p className="text-xs text-espresso-400">
            Waiting for another member to endorse this market. It expires automatically if nobody does before betting
            would close, or after 24 hours, whichever comes first.
          </p>
        ) : (
          <EndorseActionBar groupId={groupId} marketId={marketId} />
        )}
      </main>
    );
  }

  // ── Open market (2a–2f) ───────────────────────────────────────────────────────────────────
  // Fixed section order for every market type: your position if you have one, otherwise the card
  // explaining what you're choosing between; then how it settles; then what happens next; then
  // the bet slip. Odds stay sealed throughout, so the position card carries no payout column.
  if (isOpen) {
    const stakedRows: PositionTicketRow[] = computeStakedPositions(myBets, optionLabelById);
    const hasPosition = stakedRows.length > 0;

    return (
      <BetslipProvider>
        <main className="mx-auto max-w-lg space-y-4 px-5 py-8">
          {header}

          <PoolStrip
            cells={[
              { label: 'Pool', value: formatTokens(openBetVolume ?? 0) },
              { label: 'Bets', value: openBetCount ?? 0 },
              { label: 'Closes in', value: <ClosesInValue closesAt={marketRow.closes_at} /> },
            ]}
          />
          {bonusPoolNote}

          {hasPosition ? (
            <PositionTicket
              rows={stakedRows}
              meta={kindLabel}
              showProjection={false}
              footer={
                openBetCount !== null
                  ? `${myBets.length} of ${openBetCount} ${openBetCount === 1 ? 'bet' : 'bets'} on this market`
                  : undefined
              }
            />
          ) : marketRow.market_type === 'over_under' && lineLabel ? (
            <LineTicket lineLabel={lineLabel} />
          ) : isMultipleChoice && marketOptions && marketOptions.length > 0 ? (
            <OptionsTicket options={marketOptions} />
          ) : null}

          <HowItSettlesCard
            description={marketRow.description}
            people={{ creator: creatorNickname, sponsor: sponsorNickname, subjects: subjectNicknames }}
            note={ownerVoidNote}
          >
            <ClarificationRequests
              groupId={groupId}
              marketId={marketId}
              status={marketRow.status}
              description={marketRow.description}
              isCreator={isCreator}
              clarifications={clarificationList}
            />
          </HowItSettlesCard>

          <Card>
            <ResolutionTimeline resolutionWindowHours={resolutionWindowHours} stage="open">
              <ProposeResolutionCard
                groupId={groupId}
                market={marketRow}
                options={marketOptions}
                resolutionWindowHours={resolutionWindowHours}
                variant="embedded"
              />
            </ResolutionTimeline>
          </Card>

          <BetslipBar
            groupId={groupId}
            market={marketRow}
            balance={balance}
            options={marketOptions}
            existingBets={myBets}
            allowHedgedBets={groupSettings?.allow_hedged_bets ?? true}
            seedAmount={groupSettings?.seed_amount ?? 1000}
            betCount={openBetCount}
            betVolume={openBetVolume}
          />
        </main>
      </BetslipProvider>
    );
  }

  // ── Proposed outcome (2g) ─────────────────────────────────────────────────────────────────
  // The call is the hero; challenging is the exception, so it sits under a divider in the
  // timeline card and there is no bottom bar competing with it.
  if (isProposed && proposal) {
    const proposedKey = proposal.proposed_option_id ?? proposal.proposed_outcome;
    // VOID refunds everyone, so neither "wins" nor "loses" describes it — the column drops back
    // to the neutral "if it lands" reading rather than telling someone a stake they'd get back
    // in full is lost.
    const proposedVoid = proposal.proposed_outcome === 'void';
    const rows: PositionTicketRow[] = computePositions(
      myBets,
      !isMultipleChoice ? (odds ?? undefined) : undefined,
      isMultipleChoice ? (optionOdds ?? undefined) : undefined
    ).map((p) => ({ ...p, standsToWin: proposedVoid ? undefined : p.key === proposedKey }));

    return (
      <main className="mx-auto max-w-lg space-y-4 px-5 py-8">
        {header}

        <PoolStrip
          cells={[
            { label: 'Pool', value: formatTokens(closedVolume ?? 0) },
            { label: 'Bets', value: closedBetCount ?? 0 },
            {
              label: 'Final in',
              value: (
                <CountdownTimer
                  target={new Date(new Date(proposal.proposed_at).getTime() + resolutionWindowHours * 3_600_000).toISOString()}
                  prefix=""
                />
              ),
            },
          ]}
        />

        <ProposedOutcomeTicket
          marketId={marketId}
          outcomeLabel={(proposedOptionLabel ?? proposal.proposed_outcome ?? '').toUpperCase()}
          proposerNickname={proposerNickname}
          justification={proposal.justification}
          hasPhoto={!!proposal.photo_path}
          sideOdds={!isMultipleChoice ? (odds ?? undefined) : undefined}
          optionOdds={isMultipleChoice ? (optionOdds ?? undefined) : undefined}
          lineLabel={lineLabel}
        />

        <PositionTicket rows={rows} meta={kindLabel} />

        <SettlementCard description={marketRow.description} />

        <Card>
          <ResolutionTimeline resolutionWindowHours={resolutionWindowHours} stage="proposed" proposerNickname={proposerNickname}>
            <ChallengeAction
              groupId={groupId}
              marketId={marketId}
              proposedAt={proposal.proposed_at}
              resolutionWindowHours={resolutionWindowHours}
              iAmProposer={proposal.proposer_id === user!.id}
            />
          </ResolutionTimeline>
        </Card>
      </main>
    );
  }

  // ── Betting closed, and the secret ballot ─────────────────────────────────────────────────
  // Not covered by the market-template designs; these keep their existing composition and just
  // inherit the shared chrome above.
  return (
    <main className="mx-auto max-w-lg space-y-4 px-5 py-8">
      {header}

      {isClosed && (
        <>
          <PoolStrip
            cells={[
              { label: 'Pool', value: formatTokens(closedVolume ?? 0) },
              { label: 'Bets', value: closedBetCount ?? 0 },
              { label: 'Status', value: 'Closed' },
            ]}
          />
          <FinalOddsCard
            sideOdds={!isMultipleChoice ? (odds ?? undefined) : undefined}
            optionOdds={isMultipleChoice ? (optionOdds ?? undefined) : undefined}
            lineLabel={lineLabel}
            myBets={myBets}
          />
          <SettlementCard description={marketRow.description} />
          <ProposeResolutionCard
            groupId={groupId}
            market={marketRow}
            options={marketOptions}
            resolutionWindowHours={resolutionWindowHours}
            variant="waiting"
          />
          <Card>
            <ResolutionTimeline resolutionWindowHours={resolutionWindowHours} />
          </Card>
        </>
      )}

      {isDisputed && (
        <>
          {/* Pool/bets/vote-clock sits above the ballot, not under it: it's the context you read
              before deciding how to vote (and the clock you're racing), so burying it below a card
              tall enough to push it off-screen made it easy to miss entirely. */}
          <PoolStrip
            cells={[
              { label: 'Pool', value: formatTokens(closedVolume ?? 0) },
              { label: 'Bets', value: closedBetCount ?? 0 },
              {
                label: 'Vote ends',
                value: challenge ? (
                  <CountdownTimer target={new Date(new Date(challenge.created_at).getTime() + resolutionWindowHours * 3_600_000).toISOString()} prefix="" />
                ) : (
                  '—'
                ),
              },
            ]}
          />
          <MarketActions
            groupId={groupId}
            market={marketRow}
            isCreator={isCreator}
            isSponsor={marketRow.sponsor_id === user?.id}
            isOwner={isOwner}
            ownerIsSubject={ownerIsSubject}
            proposal={proposal}
            challenge={challenge}
            myVote={myVote}
            currentUserId={user!.id}
            proposerNickname={proposerNickname}
            options={marketOptions}
            resolutionWindowHours={resolutionWindowHours}
            votesCast={votesCast}
            eligibleVoters={eligibleVoters}
            hideVoidCard
          />
          <YourPositionCard
            myBets={myBets}
            sideOdds={!isMultipleChoice ? (odds ?? undefined) : undefined}
            optionOdds={isMultipleChoice ? (optionOdds ?? undefined) : undefined}
          />
          <SettlementCard
            moneySplit={
              !isMultipleChoice && oddsA && oddsB
                ? [
                    { label: sideA.toUpperCase(), percent: oddsA.pool_percent },
                    { label: sideB.toUpperCase(), percent: oddsB.pool_percent },
                  ]
                : undefined
            }
            description={marketRow.description}
          />
          <Card>
            <ResolutionTimeline resolutionWindowHours={resolutionWindowHours} stage="disputed" />
          </Card>
        </>
      )}
    </main>
  );
}
