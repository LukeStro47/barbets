import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { notFoundIfEmpty } from '@/lib/errors';
import { PageHeader } from '@/components/ui/PageHeader';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { SealedCount } from '@/components/markets/SealedCount';
import { OddsBar, OddsBarMulti } from '@/components/markets/OddsBar';
import { CountdownTimer } from '@/components/ui/CountdownTimer';
import { MarketActions } from '@/components/markets/MarketActions';
import { OptionLabel } from '@/components/markets/OptionLabel';
import { Mention } from '@/components/ui/Mention';
import { STATUS_LABEL, STATUS_TONE } from '@/lib/marketStatus';
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

  const [{ data: membership }, { data: subjectRows }, { data: options }] = await Promise.all([
    supabase.from('memberships').select('balance').eq('group_id', groupId).eq('user_id', user!.id).single(),
    supabase.from('market_subjects').select('user_id').eq('market_id', marketId),
    isMultipleChoice
      ? supabase.from('market_options').select('id, market_id, label, sort_order').eq('market_id', marketId).order('sort_order')
      : Promise.resolve({ data: null }),
  ]);

  const subjectUserIds = (subjectRows ?? []).map((s) => s.user_id);
  const namedUserIds = [marketRow.creator_id, ...(marketRow.sponsor_id ? [marketRow.sponsor_id] : []), ...subjectUserIds];
  const { data: namedMembers } =
    namedUserIds.length > 0
      ? await supabase.from('memberships').select('user_id, nickname').eq('group_id', groupId).in('user_id', namedUserIds)
      : { data: [] };
  const nicknameByUserId = new Map((namedMembers ?? []).map((m) => [m.user_id, m.nickname]));
  const creator = { nickname: nicknameByUserId.get(marketRow.creator_id) };
  const sponsor = marketRow.sponsor_id ? { nickname: nicknameByUserId.get(marketRow.sponsor_id) } : null;
  const subjects = subjectUserIds.map((userId) => ({ nickname: nicknameByUserId.get(userId) }));

  const balance = membership?.balance ?? 0;
  const marketOptions = options as MarketOption[] | null;

  let openBetCount: number | null = null;
  let odds: { side: string; pool_amount: number; pool_percent: number; bet_count: number }[] | null = null;
  let optionOdds: { option_id: string; label: string; pool_percent: number }[] | null = null;
  let proposal: { proposer_id: string; proposed_outcome: string | null; proposed_option_id: string | null; justification: string | null; proposed_at: string } | null = null;
  let challenge: { challenger_id: string; created_at: string } | null = null;
  let myBets: { side: string | null; option_id: string | null; amount: number }[] = [];
  let myVote: { outcome: string | null; voted_option_id: string | null } | null = null;

  if (marketRow.status === 'open') {
    const { data } = await supabase.rpc('get_open_bet_count', { p_market_id: marketId });
    openBetCount = data as number;
    const { data: bets } = await supabase.from('bets').select('side, option_id, amount').eq('market_id', marketId).eq('user_id', user!.id);
    myBets = bets ?? [];
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
      .select('proposer_id, proposed_outcome, proposed_option_id, justification, proposed_at')
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
  const proposedOptionLabel = proposal?.proposed_option_id
    ? marketOptions?.find((o) => o.id === proposal!.proposed_option_id)?.label
    : null;
  const optionLabelById = (id: string) => marketOptions?.find((o) => o.id === id)?.label ?? '?';

  return (
    <main className="mx-auto max-w-lg space-y-6 px-5 py-8">
      <PageHeader
        title={marketRow.title}
        backHref={`/groups/${groupId}`}
        backLabel="Group"
        action={<Badge tone={STATUS_TONE[marketRow.status]}>{STATUS_LABEL[marketRow.status]}</Badge>}
      />

      <Card className="space-y-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-espresso-400">Resolution criteria</p>
          <p className="mt-0.5 text-espresso-600">{marketRow.description}</p>
        </div>
        {marketRow.market_type === 'over_under' && (
          <div className="inline-flex items-center gap-1.5 rounded-xl bg-honey-50 px-3 py-1.5">
            <span className="text-xs font-semibold uppercase tracking-wide text-honey-700">Line</span>
            <span className="font-display text-lg font-bold text-honey-800">{marketRow.line}</span>
          </div>
        )}

        <div className="space-y-0.5 text-xs text-espresso-400">
          <p>
            Started by <Mention nickname={creator?.nickname ?? ''} />
          </p>
          {sponsor && (
            <p>
              Endorsed by <Mention nickname={sponsor.nickname ?? ''} />
            </p>
          )}
          {subjects.length > 0 && (
            <p>
              Hidden from{' '}
              {subjects.map((s, i) => (
                <span key={i}>
                  {i > 0 && ', '}
                  <Mention nickname={s.nickname ?? ''} />
                </span>
              ))}
            </p>
          )}
        </div>

        {marketRow.status === 'pending_sponsor' && (
          <div className="space-y-2">
            <p className="text-sm text-espresso-500">
              Waiting for another member to endorse this market. It expires automatically 72 hours after creation if
              nobody does.
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

        {marketRow.status === 'open' && (
          <div className="flex items-center justify-between">
            {openBetCount !== null && <SealedCount count={openBetCount} />}
            <span className="text-sm font-medium text-espresso-500">
              <CountdownTimer target={marketRow.closes_at} clickable />
            </span>
          </div>
        )}

        {marketRow.status === 'open' && myBets.length > 0 && (
          <div className="rounded-xl bg-honey-50 p-3 text-sm">
            <p className="font-semibold text-honey-800">Your bets on this market</p>
            <ul className="mt-1 space-y-0.5 text-honey-700">
              {myBets.map((b, i) => (
                <li key={i}>
                  {b.amount} on <OptionLabel label={(b.option_id ? optionLabelById(b.option_id) : b.side ?? '').toUpperCase()} />
                </li>
              ))}
            </ul>
          </div>
        )}

        {marketRow.closed_at && marketRow.closed_at < marketRow.closes_at && (
          <p className="text-xs font-semibold text-espresso-400">Closed early by proposal</p>
        )}

        {!isMultipleChoice && oddsA && oddsB && (
          <OddsBar
            left={{ label: sideA.toUpperCase(), percent: oddsA.pool_percent }}
            right={{ label: sideB.toUpperCase(), percent: oddsB.pool_percent }}
            center={marketRow.market_type === 'over_under' ? marketRow.line ?? undefined : undefined}
          />
        )}

        {isMultipleChoice && optionOdds && optionOdds.length > 0 && (
          <OddsBarMulti options={optionOdds.map((o) => ({ id: o.option_id, label: o.label, percent: o.pool_percent }))} />
        )}

        {proposal && (
          <div className="rounded-xl bg-espresso-50 p-3 text-sm text-espresso-600">
            <p className="font-semibold text-espresso-800">
              Proposed: <OptionLabel label={(proposedOptionLabel ?? proposal.proposed_outcome ?? '').toUpperCase()} />
            </p>
            {proposal.justification && <p className="mt-1">{proposal.justification}</p>}
          </div>
        )}
      </Card>

      <MarketActions
        groupId={groupId}
        market={marketRow}
        isCreator={marketRow.creator_id === user?.id}
        isSponsor={marketRow.sponsor_id === user?.id}
        balance={balance}
        proposal={proposal}
        challenge={challenge}
        myVote={myVote}
        currentUserId={user!.id}
        options={marketOptions}
      />
    </main>
  );
}
