import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { notFoundIfEmpty } from '@/lib/errors';
import { PageHeader } from '@/components/ui/PageHeader';
import { RevealSummary } from '@/components/markets/RevealSummary';
import { Mention } from '@/components/ui/Mention';
import type { Market, MarketOption } from '@/lib/actions/markets';

export default async function RevealPage({ params }: { params: Promise<{ groupId: string; marketId: string }> }) {
  const { groupId, marketId } = await params;
  const supabase = await createClient();

  const { data: market } = await supabase.from('visible_markets').select('*').eq('id', marketId).single();
  const marketRow = notFoundIfEmpty<Market>(market);
  const isMultipleChoice = marketRow.market_type === 'multiple_choice';

  if (marketRow.status !== 'resolved' && marketRow.status !== 'voided') {
    redirect(`/groups/${groupId}/markets/${marketId}`);
  }

  const [{ data: bets }, { data: odds }, { data: optionOdds }, { data: options }] = await Promise.all([
    supabase.from('bets').select('user_id, side, option_id, amount, payout').eq('market_id', marketId),
    isMultipleChoice ? Promise.resolve({ data: null }) : supabase.rpc('get_closed_odds', { p_market_id: marketId }),
    isMultipleChoice ? supabase.rpc('get_closed_odds_options', { p_market_id: marketId }) : Promise.resolve({ data: null }),
    isMultipleChoice
      ? supabase.from('market_options').select('id, market_id, label, sort_order').eq('market_id', marketId).order('sort_order')
      : Promise.resolve({ data: null }),
  ]);

  const marketOptions = options as MarketOption[] | null;
  const optionLabelById = (id: string) => marketOptions?.find((o) => o.id === id)?.label ?? '?';

  const namedUserIds = [
    marketRow.creator_id,
    ...(marketRow.sponsor_id ? [marketRow.sponsor_id] : []),
    ...(bets ?? []).map((b) => b.user_id),
  ];
  const { data: namedMembers } =
    namedUserIds.length > 0
      ? await supabase.from('memberships').select('user_id, nickname').eq('group_id', groupId).in('user_id', namedUserIds)
      : { data: [] };
  const nicknameByUserId = new Map((namedMembers ?? []).map((m) => [m.user_id, m.nickname]));
  const creator = { nickname: nicknameByUserId.get(marketRow.creator_id) };
  const sponsor = marketRow.sponsor_id ? { nickname: nicknameByUserId.get(marketRow.sponsor_id) } : null;

  const headline =
    marketRow.status === 'voided'
      ? 'VOIDED'
      : isMultipleChoice
        ? (marketOptions?.find((o) => o.id === marketRow.outcome_option_id)?.label ?? '?')
        : (marketRow.outcome ?? '').toUpperCase();

  return (
    <main className="mx-auto max-w-lg space-y-6 px-5 py-8">
      <PageHeader
        title={marketRow.title}
        subtitle={marketRow.status === 'voided' ? 'Voided market' : 'Resolved market'}
        backHref={`/groups/${groupId}`}
        backLabel="Group"
      />
      <p className="-mt-4 text-xs text-espresso-400">
        Started by <Mention nickname={creator?.nickname ?? ''} />
        {sponsor && (
          <>
            {' · Endorsed by '}
            <Mention nickname={sponsor.nickname ?? ''} />
          </>
        )}
        {marketRow.closed_at && marketRow.closed_at < marketRow.closes_at ? ' · Closed early by proposal' : ''}
      </p>
      <RevealSummary
        headline={headline}
        actualValue={marketRow.actual_value}
        marketType={marketRow.market_type}
        line={marketRow.line}
        bets={(bets ?? []).map((b) => ({
          nickname: nicknameByUserId.get(b.user_id) ?? '?',
          choiceLabel: b.option_id ? optionLabelById(b.option_id) : b.side ?? '',
          amount: b.amount,
          payout: b.payout,
          isWinner: isMultipleChoice ? b.option_id === marketRow.outcome_option_id : b.side === marketRow.outcome,
        }))}
        odds={(odds ?? []).map((o: any) => ({ side: o.side, percent: o.pool_percent }))}
        optionOdds={(optionOdds ?? []).map((o: any) => ({ id: o.option_id, label: o.label, percent: o.pool_percent }))}
        payoutBreakdown={marketRow.payout_breakdown}
        creatorNickname={creator?.nickname ?? undefined}
        sponsorNickname={sponsor?.nickname ?? undefined}
      />
    </main>
  );
}
