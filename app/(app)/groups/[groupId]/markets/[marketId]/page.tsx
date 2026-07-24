import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { notFoundIfEmpty } from '@/lib/errors';
import { PageHeader } from '@/components/ui/PageHeader';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { StatStrip, StatTile } from '@/components/markets/StatStrip';
import { ClosesInStatTile } from '@/components/markets/ClosesInStatTile';
import { CountdownTimer } from '@/components/ui/CountdownTimer';
import { BonusPoolTile } from '@/components/markets/BonusPoolTile';
import { OddsBar, OddsBarMulti } from '@/components/markets/OddsBar';
import { MarketActions } from '@/components/markets/MarketActions';
import { ClarificationRequests, type Clarification } from '@/components/markets/ClarificationRequests';
import { ProposeResolutionCard } from '@/components/markets/ProposeResolutionCard';
import { ResolutionProofButton } from '@/components/markets/ResolutionProofButton';
import { BetslipBar } from '@/components/markets/BetslipBar';
import { MyBetsCard } from '@/components/markets/MyBetsCard';
import { OptionLabel } from '@/components/markets/OptionLabel';
import { Mention } from '@/components/ui/Mention';
import { STATUS_LABEL, STATUS_TONE } from '@/lib/marketStatus';
import { formatTokens } from '@/lib/formatNumber';
import { formatLine } from '@/lib/units';
import type { Market, MarketOption } from '@/lib/actions/markets';

export default async function MarketDetailPage({
  params,
}: {
  params: Promise<{ groupId: string; marketId: string }>;
}) {
  const { groupId, marketId } = await params;
  const supabase = await createClient();

  const { data: market } = await supabase.from('visible_markets').select('*').eq('id', marketId).single();
  const marketRow = notFoundIfEmpty<Market>(market);
  const isMultipleChoice = marketRow.market_type === 'multiple_choice';

  if (marketRow.status === 'resolved' || marketRow.status === 'voided') {
    redirect(`/groups/${groupId}/markets/${marketId}/reveal`);
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const isCreator = marketRow.creator_id === user?.id;

  const [{ data: membership }, { data: subjectRows }, { data: options }, { data: group }, { data: clarificationRows }, { data: groupSettings }] =
    await Promise.all([
      supabase.from('memberships').select('balance').eq('group_id', groupId).eq('user_id', user!.id).single(),
      supabase.from('market_subjects').select('user_id').eq('market_id', marketId),
      isMultipleChoice
        ? supabase.from('market_options').select('id, market_id, label, sort_order').eq('market_id', marketId).order('sort_order')
        : Promise.resolve({ data: null }),
      supabase.from('groups').select('owner_id').eq('id', groupId).single(),
      supabase
        .from('resolution_clarifications')
        .select('id, requester_id, question, created_at')
        .eq('market_id', marketId)
        .order('created_at'),
      supabase.from('group_settings').select('allow_hedged_bets, seed_amount').eq('group_id', groupId).single(),
    ]);
  const isOwner = group?.owner_id === user?.id;

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
  const creator = { nickname: nicknameByUserId.get(marketRow.creator_id) };
  const sponsor = marketRow.sponsor_id ? { nickname: nicknameByUserId.get(marketRow.sponsor_id) } : null;
  const subjects = subjectUserIds.map((userId) => ({ nickname: nicknameByUserId.get(userId) }));
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

  if (marketRow.status !== 'pending_sponsor') {
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

  const statTiles: React.ReactNode[] = [];
  if (marketRow.market_type === 'over_under') {
    statTiles.push(<StatTile key="line" label="Line" value={formatLine(marketRow.line, marketRow.unit)} accent />);
  }
  if (marketRow.status === 'open') {
    statTiles.push(<ClosesInStatTile key="closes" closesAt={marketRow.closes_at} />);
    if (openBetCount !== null) statTiles.push(<StatTile key="bets" label="Bets" value={openBetCount} />);
    if (openBetVolume !== null && openBetVolume > 0)
      statTiles.push(<StatTile key="volume" label="Volume" value={formatTokens(openBetVolume)} />);
  } else {
    if (closedBetCount !== null && closedBetCount > 0) statTiles.push(<StatTile key="bets" label="Bets" value={closedBetCount} />);
    if (closedVolume !== null && closedVolume > 0)
      statTiles.push(<StatTile key="volume" label="Volume" value={formatTokens(closedVolume)} />);
  }
  if (marketRow.bonus_pool > 0) {
    statTiles.push(<BonusPoolTile key="bonus" amount={marketRow.bonus_pool} carriedAmount={marketRow.carried_bonus_pool} />);
  }

  return (
    <main className="mx-auto max-w-lg space-y-6 px-5 py-8">
      <PageHeader
        title={marketRow.title}
        backHref={`/groups/${groupId}`}
        backLabel="Group"
        action={
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
          </div>
        }
      />

      {statTiles.length > 0 && <StatStrip>{statTiles}</StatStrip>}

      {marketRow.status !== 'pending_sponsor' && <MyBetsCard bets={myBets} optionLabelById={optionLabelById} />}

      <Card className="relative space-y-3">
        <div className="space-y-2">
          <div className="pr-8">
            <p className="text-xs font-semibold uppercase tracking-wide text-espresso-400">Resolution criteria</p>
            <p className="mt-0.5 text-espresso-600">{marketRow.description}</p>
          </div>

          <div className="flex flex-wrap gap-1.5">
            <span className="inline-flex items-center gap-1 rounded-full bg-espresso-50 px-2.5 py-1 text-xs font-medium text-espresso-600">
              <span className="text-espresso-400">Started by</span>
              <Mention nickname={creator?.nickname ?? ''} />
            </span>
            {sponsor && (
              <span className="inline-flex items-center gap-1 rounded-full bg-espresso-50 px-2.5 py-1 text-xs font-medium text-espresso-600">
                <span className="text-espresso-400">Endorsed by</span>
                <Mention nickname={sponsor.nickname ?? ''} />
              </span>
            )}
            {subjects.length > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-espresso-50 px-2.5 py-1 text-xs font-medium text-espresso-600">
                <span className="text-espresso-400">Hidden from</span>
                {subjects.map((s, i) => (
                  <span key={i}>
                    {i > 0 && ', '}
                    <Mention nickname={s.nickname ?? ''} />
                  </span>
                ))}
              </span>
            )}
          </div>
        </div>

        <ClarificationRequests
          groupId={groupId}
          marketId={marketId}
          status={marketRow.status}
          description={marketRow.description}
          isCreator={isCreator}
          clarifications={clarificationList}
        />

        {marketRow.status === 'pending_sponsor' && (
          <div className="space-y-2">
            <p className="text-sm text-espresso-600">
              <CountdownTimer target={marketRow.closes_at} prefix="Betting closes" />
            </p>
            <p className="text-sm text-espresso-500">
              Waiting for another member to endorse this market. It expires automatically if nobody does before
              betting would close, or after 24 hours, whichever comes first.
            </p>
            {isMultipleChoice && marketOptions && (
              <div className="space-y-1.5">
                <p className="text-xs font-semibold uppercase tracking-wide text-espresso-400">Multiple choice options</p>
                <ul className="space-y-1.5">
                  {marketOptions.map((o) => (
                    <li
                      key={o.id}
                      className="rounded-xl border-2 border-honey-300 bg-honey-50 px-3 py-2 text-sm font-semibold text-honey-800"
                    >
                      <OptionLabel label={o.label} />
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {marketRow.closed_at && marketRow.closed_at < marketRow.closes_at && (
          <p className="text-xs font-semibold text-espresso-400">Closed early by proposal</p>
        )}

        {!isMultipleChoice && oddsA && oddsB && (
          <OddsBar left={{ label: sideA.toUpperCase(), percent: oddsA.pool_percent }} right={{ label: sideB.toUpperCase(), percent: oddsB.pool_percent }} />
        )}

        {isMultipleChoice && optionOdds && optionOdds.length > 0 && (
          <OddsBarMulti options={optionOdds.map((o) => ({ id: o.option_id, label: o.label, percent: o.pool_percent }))} />
        )}

        {proposal && (
          <div className="relative rounded-xl bg-espresso-50 p-3 text-sm text-espresso-600">
            {proposal.photo_path && (
              <div className="absolute top-2 right-2">
                <ResolutionProofButton marketId={marketId} variant="icon" />
              </div>
            )}
            <p className={`font-semibold text-espresso-800 ${proposal.photo_path ? 'pr-8' : ''}`}>
              Proposed: <OptionLabel label={(proposedOptionLabel ?? proposal.proposed_outcome ?? '').toUpperCase()} />
            </p>
            {proposal.justification && <p className="mt-1">{proposal.justification}</p>}
          </div>
        )}

        {(marketRow.status === 'open' || marketRow.status === 'closed') && (
          <ProposeResolutionCard groupId={groupId} market={marketRow} options={marketOptions} />
        )}
      </Card>

      <MarketActions
        groupId={groupId}
        market={marketRow}
        isCreator={marketRow.creator_id === user?.id}
        isSponsor={marketRow.sponsor_id === user?.id}
        isOwner={isOwner}
        ownerIsSubject={ownerIsSubject}
        proposal={proposal}
        challenge={challenge}
        myVote={myVote}
        currentUserId={user!.id}
        options={marketOptions}
      />

      {marketRow.status === 'open' && (
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
      )}
    </main>
  );
}
