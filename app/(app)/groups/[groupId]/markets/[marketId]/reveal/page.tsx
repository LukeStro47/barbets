import { redirect } from 'next/navigation';
import { createClient, requireUser } from '@/lib/supabase/server';
import { notFoundIfEmpty } from '@/lib/errors';
import { ScreenHeader } from '@/components/ui/Screen';
import { RevealSummary } from '@/components/markets/RevealSummary';
import { StatusChip, MarketTabs, MarketTitleBlock, sideTitle } from '@/components/markets/MarketScreen';
import { formatRelativeTime } from '@/lib/formatRelativeTime';
import type { Market, MarketOption } from '@/lib/actions/markets';

/**
 * 4m: a settled market. Same frame as every other market state — the group name in the header
 * with an ink "Settled" chip, the question with who called it, then the Market/Comments tabs — and
 * the result stack under it. 4m's own footer ("Challenge this result · 8h left") is deliberately
 * not built: challenge_resolution() only ever succeeds on a `proposed` market, so a settled one
 * has nothing left to challenge (the call's challenge window lives on the market page itself).
 */
export default async function RevealPage({ params }: { params: Promise<{ groupId: string; marketId: string }> }) {
  const { groupId, marketId } = await params;
  const supabase = await createClient();

  const user = await requireUser(supabase);

  const { data: market } = await supabase.from('visible_markets').select('*').eq('id', marketId).single();
  const marketRow = notFoundIfEmpty<Market>(market);
  const isMultipleChoice = marketRow.market_type === 'multiple_choice';

  if (marketRow.status !== 'resolved' && marketRow.status !== 'voided') {
    redirect(`/groups/${groupId}/markets/${marketId}`);
  }

  const [
    { data: bets },
    { data: options },
    { data: group },
    { data: subjectRows },
    { data: proposal },
    { count: commentCount },
    { data: latestCommentRow },
  ] = await Promise.all([
    supabase.from('bets').select('user_id, side, option_id, amount, payout').eq('market_id', marketId),
    isMultipleChoice
      ? supabase.from('market_options').select('id, market_id, label, sort_order').eq('market_id', marketId).order('sort_order')
      : Promise.resolve({ data: null }),
    supabase.from('groups').select('name').eq('id', groupId).single(),
    supabase.from('market_subjects').select('user_id').eq('market_id', marketId),
    marketRow.status === 'resolved'
      ? supabase.from('resolution_proposals').select('proposer_id, justification, photo_path').eq('market_id', marketId).maybeSingle()
      : Promise.resolve({ data: null }),
    supabase.from('market_comments').select('id', { count: 'exact', head: true }).eq('market_id', marketId).is('deleted_at', null),
    supabase
      .from('market_comments')
      .select('user_id, body')
      .eq('market_id', marketId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const marketOptions = options as MarketOption[] | null;
  const optionLabelById = (id: string) => marketOptions?.find((o) => o.id === id)?.label ?? '?';

  const subjectUserIds = (subjectRows ?? []).map((s) => s.user_id);
  // Drop nulls before the `.in()` — system markets have creator_id = null (and deleted accounts
  // null bets.user_id). PostgREST rejects or empties an `in` list that contains null.
  const namedUserIds = [
    ...new Set(
      [
        marketRow.creator_id,
        marketRow.sponsor_id,
        proposal?.proposer_id,
        latestCommentRow?.user_id,
        ...(bets ?? []).map((b) => b.user_id),
        ...subjectUserIds,
        user.id,
      ].filter((id): id is string => id != null)
    ),
  ];
  const [{ data: namedMembers }, { data: namedUsers }] =
    namedUserIds.length > 0
      ? await Promise.all([
          supabase.from('memberships').select('user_id, nickname').eq('group_id', groupId).in('user_id', namedUserIds),
          supabase.from('users').select('id, avatar_updated_at, avatar_preset_key').in('id', namedUserIds),
        ])
      : [{ data: [] }, { data: [] }];
  const nicknameByUserId = new Map((namedMembers ?? []).map((m) => [m.user_id, m.nickname]));
  const avatarByUser = new Map((namedUsers ?? []).map((u) => [u.id, u]));

  const myNickname = nicknameByUserId.get(user.id) ?? '';
  const creatorNickname = marketRow.creator_id ? nicknameByUserId.get(marketRow.creator_id) : undefined;
  const sponsorNickname = marketRow.sponsor_id ? nicknameByUserId.get(marketRow.sponsor_id) : undefined;
  const calledBy = proposal?.proposer_id ? nicknameByUserId.get(proposal.proposer_id) : undefined;
  const hiddenFrom = subjectUserIds.map((userId) => `@${nicknameByUserId.get(userId) ?? '?'}`);
  const isSubjectOfThisMarket = subjectUserIds.includes(user.id);

  const headline =
    marketRow.status === 'voided'
      ? 'VOIDED'
      : isMultipleChoice
        ? (marketOptions?.find((o) => o.id === marketRow.outcome_option_id)?.label ?? '?')
        : sideTitle(marketRow.outcome ?? '');

  const resolvedAgo = formatRelativeTime(marketRow.resolved_at ?? marketRow.created_at);
  const subtitle = marketRow.status === 'voided' ? `Voided ${resolvedAgo}` : calledBy ? `Called by @${calledBy}, ${resolvedAgo}` : `Settled ${resolvedAgo}`;

  const latestAvatar = latestCommentRow ? avatarByUser.get(latestCommentRow.user_id) : undefined;

  return (
    <>
      <ScreenHeader
        title={group?.name ?? 'Group'}
        tone="context"
        href={`/groups/${groupId}`}
        right={<StatusChip label={marketRow.status === 'voided' ? 'Void' : 'Settled'} tone="ink" />}
      />
      <main className="mx-auto flex max-w-[430px] flex-col gap-[13px] px-[18px] pt-[13px] pb-10">
        <MarketTitleBlock
          title={marketRow.title}
          subtitle={subtitle}
          tabs={<MarketTabs groupId={groupId} marketId={marketId} active="market" commentCount={commentCount ?? 0} />}
        />
        <RevealSummary
          groupName={group?.name ?? ''}
          question={marketRow.title}
          headline={headline}
          actualValue={marketRow.actual_value}
          marketType={marketRow.market_type}
          line={marketRow.line}
          unit={marketRow.unit}
          bets={(bets ?? []).map((b) => {
            const av = b.user_id ? avatarByUser.get(b.user_id) : undefined;
            return {
              nickname: (b.user_id && nicknameByUserId.get(b.user_id)) || '?',
              userId: b.user_id ?? undefined,
              avatarUpdatedAt: av?.avatar_updated_at ?? null,
              avatarPresetKey: av?.avatar_preset_key ?? null,
              choiceLabel: b.option_id ? optionLabelById(b.option_id) : (b.side ?? ''),
              amount: b.amount,
              payout: b.payout,
              isWinner: isMultipleChoice ? b.option_id === marketRow.outcome_option_id : b.side === marketRow.outcome,
            };
          })}
          payoutBreakdown={marketRow.payout_breakdown}
          carriedBonusPool={marketRow.carried_bonus_pool}
          creatorNickname={creatorNickname}
          sponsorNickname={sponsorNickname}
          justification={proposal?.justification ?? null}
          hasProof={!!proposal?.photo_path}
          hiddenFrom={hiddenFrom}
          groupId={groupId}
          marketId={marketId}
          myNickname={myNickname}
          isSubjectOfThisMarket={isSubjectOfThisMarket}
          commentCount={commentCount ?? 0}
          calledByNickname={calledBy}
          latestComment={
            latestCommentRow
              ? {
                  userId: latestCommentRow.user_id,
                  nickname: nicknameByUserId.get(latestCommentRow.user_id) ?? '?',
                  avatarUpdatedAt: latestAvatar?.avatar_updated_at ?? null,
                  avatarPresetKey: latestAvatar?.avatar_preset_key ?? null,
                  body: latestCommentRow.body,
                }
              : null
          }
        />
      </main>
    </>
  );
}
