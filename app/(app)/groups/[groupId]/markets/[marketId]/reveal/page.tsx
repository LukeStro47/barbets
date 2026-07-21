import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { notFoundIfEmpty } from '@/lib/errors';
import { Badge } from '@/components/ui/Badge';
import { RevealSummary } from '@/components/markets/RevealSummary';
import { Mention } from '@/components/ui/Mention';
import { STATUS_LABEL, STATUS_TONE } from '@/lib/marketStatus';
import type { Market, MarketOption } from '@/lib/actions/markets';
import type { ReactionEmoji } from '@/lib/actions/reactions';

export default async function RevealPage({ params }: { params: Promise<{ groupId: string; marketId: string }> }) {
  const { groupId, marketId } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: market } = await supabase.from('visible_markets').select('*').eq('id', marketId).single();
  const marketRow = notFoundIfEmpty<Market>(market);
  const isMultipleChoice = marketRow.market_type === 'multiple_choice';

  if (marketRow.status !== 'resolved' && marketRow.status !== 'voided') {
    redirect(`/groups/${groupId}/markets/${marketId}`);
  }

  const [{ data: bets }, { data: odds }, { data: optionOdds }, { data: options }, { data: group }, { data: subjectRows }, { data: proposal }, { data: reactionRows }] =
    await Promise.all([
      supabase.from('bets').select('user_id, side, option_id, amount, payout').eq('market_id', marketId),
      isMultipleChoice ? Promise.resolve({ data: null }) : supabase.rpc('get_closed_odds', { p_market_id: marketId }),
      isMultipleChoice ? supabase.rpc('get_closed_odds_options', { p_market_id: marketId }) : Promise.resolve({ data: null }),
      isMultipleChoice
        ? supabase.from('market_options').select('id, market_id, label, sort_order').eq('market_id', marketId).order('sort_order')
        : Promise.resolve({ data: null }),
      supabase.from('groups').select('name').eq('id', groupId).single(),
      supabase.from('market_subjects').select('user_id').eq('market_id', marketId),
      marketRow.status === 'resolved'
        ? supabase.from('resolution_proposals').select('justification, photo_path').eq('market_id', marketId).maybeSingle()
        : Promise.resolve({ data: null }),
      supabase.from('market_reactions').select('user_id, emoji').eq('market_id', marketId),
    ]);

  const reactionCounts = new Map<string, number>();
  for (const r of reactionRows ?? []) {
    reactionCounts.set(r.emoji, (reactionCounts.get(r.emoji) ?? 0) + 1);
  }
  const myReaction = (reactionRows ?? []).find((r) => r.user_id === user?.id)?.emoji ?? null;

  const marketOptions = options as MarketOption[] | null;
  const optionLabelById = (id: string) => marketOptions?.find((o) => o.id === id)?.label ?? '?';

  const subjectUserIds = (subjectRows ?? []).map((s) => s.user_id);
  const namedUserIds = [
    marketRow.creator_id,
    ...(marketRow.sponsor_id ? [marketRow.sponsor_id] : []),
    ...(bets ?? []).map((b) => b.user_id),
    ...subjectUserIds,
    ...(reactionRows ?? []).map((r) => r.user_id),
    ...(user ? [user.id] : []),
  ];
  const { data: namedMembers } =
    namedUserIds.length > 0
      ? await supabase.from('memberships').select('user_id, nickname').eq('group_id', groupId).in('user_id', namedUserIds)
      : { data: [] };
  const nicknameByUserId = new Map((namedMembers ?? []).map((m) => [m.user_id, m.nickname]));

  const reactionNicknames = new Map<string, string[]>();
  for (const r of reactionRows ?? []) {
    const nickname = nicknameByUserId.get(r.user_id);
    if (!nickname) continue;
    const list = reactionNicknames.get(r.emoji) ?? [];
    list.push(nickname);
    reactionNicknames.set(r.emoji, list);
  }
  const myNickname = user ? (nicknameByUserId.get(user.id) ?? '') : '';
  const creator = { nickname: nicknameByUserId.get(marketRow.creator_id) };
  const sponsor = marketRow.sponsor_id ? { nickname: nicknameByUserId.get(marketRow.sponsor_id) } : null;
  const hiddenFrom = subjectUserIds.map((userId) => `@${nicknameByUserId.get(userId) ?? '?'}`);

  const headline =
    marketRow.status === 'voided'
      ? 'VOIDED'
      : isMultipleChoice
        ? (marketOptions?.find((o) => o.id === marketRow.outcome_option_id)?.label ?? '?')
        : (marketRow.outcome ?? '').toUpperCase();

  return (
    <main className="mx-auto max-w-lg space-y-5 px-5 py-8">
      <div className="flex items-center justify-between gap-3">
        <Link href={`/groups/${groupId}`} className="text-sm font-medium text-espresso-500 hover:text-espresso-700">
          ← {group?.name ?? 'Group'}
        </Link>
        <Badge tone={STATUS_TONE[marketRow.status]}>{STATUS_LABEL[marketRow.status]}</Badge>
      </div>
      <RevealSummary
        groupName={group?.name ?? ''}
        question={marketRow.title}
        headline={headline}
        actualValue={marketRow.actual_value}
        marketType={marketRow.market_type}
        line={marketRow.line}
        unit={marketRow.unit}
        bets={(bets ?? []).map((b) => ({
          nickname: nicknameByUserId.get(b.user_id) ?? '?',
          choiceLabel: b.option_id ? optionLabelById(b.option_id) : b.side ?? '',
          amount: b.amount,
          payout: b.payout,
          isWinner: isMultipleChoice ? b.option_id === marketRow.outcome_option_id : b.side === marketRow.outcome,
        }))}
        odds={(odds ?? []).map((o: any) => ({ side: o.side, percent: o.pool_percent }))}
        optionOdds={(optionOdds ?? []).map((o: any) => ({
          id: o.option_id,
          label: o.label,
          percent: o.pool_percent,
          isWinner: o.option_id === marketRow.outcome_option_id,
        }))}
        payoutBreakdown={marketRow.payout_breakdown}
        creatorNickname={creator?.nickname ?? undefined}
        sponsorNickname={sponsor?.nickname ?? undefined}
        resolvedAtIso={marketRow.resolved_at ?? marketRow.created_at}
        justification={proposal?.justification ?? null}
        hasProof={!!proposal?.photo_path}
        hiddenFrom={hiddenFrom}
        groupId={groupId}
        marketId={marketId}
        reactionCounts={Object.fromEntries(reactionCounts)}
        myReaction={myReaction as ReactionEmoji | null}
        reactionNicknames={Object.fromEntries(reactionNicknames)}
        myNickname={myNickname}
      />
      <p className="text-center text-xs text-espresso-400">
        Started by <Mention nickname={creator?.nickname ?? ''} />
        {sponsor && (
          <>
            {' · Endorsed by '}
            <Mention nickname={sponsor.nickname ?? ''} />
          </>
        )}
        {marketRow.closed_at && marketRow.closed_at < marketRow.closes_at ? ' · Closed early by proposal' : ''}
      </p>
    </main>
  );
}
