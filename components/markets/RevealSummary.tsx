import Link from 'next/link';
import { RevealTicket } from '@/components/markets/RevealTicket';
import { SettlementLedger } from '@/components/markets/SettlementLedger';
import { ChatIcon, ChevronRightIcon } from '@/components/ui/icons';
import type { PayoutBreakdown } from '@/lib/actions/markets';
import type { ReactionEmoji } from '@/lib/actions/reactions';
import { formatLine } from '@/lib/units';

export interface RevealBet {
  nickname: string;
  /** Precomputed by the caller: the bet_side or the option's label, whichever applies. */
  choiceLabel: string;
  amount: number;
  payout: number | null;
  /** Precomputed by the caller by comparing this bet's side/option to the market's actual outcome — not inferred from payout, since a winning bet can still floor to a $0 payout. */
  isWinner: boolean;
}

export function RevealSummary({
  groupName,
  question,
  headline,
  actualValue,
  marketType,
  line,
  unit,
  bets,
  payoutBreakdown,
  carriedBonusPool,
  creatorNickname,
  sponsorNickname,
  resolvedAtIso,
  justification,
  hiddenFrom,
  groupId,
  marketId,
  reactionCounts,
  myReaction,
  reactionNicknames,
  myNickname,
  hasProof,
  isSubjectOfThisMarket,
  commentCount,
}: {
  groupName: string;
  /** The market's title, shown on the ticket itself since it has to be self-contained once shared outside the app. */
  question: string;
  /** Precomputed by the caller: 'VOIDED', a bet_side in caps, or the winning option's label. */
  headline: string;
  actualValue: number | null;
  marketType: 'yes_no' | 'over_under' | 'multiple_choice';
  /** over_under only. */
  line?: number | null;
  /** over_under only, e.g. "$", "min", "pts". */
  unit?: string | null;
  bets: RevealBet[];
  /** Only set when nobody predicted the outcome and the group has distribute_payout on. */
  payoutBreakdown?: PayoutBreakdown | null;
  /** markets.carried_bonus_pool: bonus tokens this market was seeded with at creation, from another
      market's earlier zero-winner split. The only bonus-pool signal that survives resolution —
      markets.bonus_pool itself is always zeroed by finalize_market() the moment a market resolves,
      whether or not it started with a carried amount. */
  carriedBonusPool?: number;
  creatorNickname?: string;
  sponsorNickname?: string;
  resolvedAtIso: string;
  /** The winning resolution proposal's justification, if one was given. */
  justification?: string | null;
  /** Subject nicknames — safe to reveal now that the market's resolved. */
  hiddenFrom: string[];
  groupId: string;
  marketId: string;
  reactionCounts: Partial<Record<ReactionEmoji, number>>;
  myReaction: ReactionEmoji | null;
  /** Nicknames of everyone who picked each reaction, for the breakdown popover. */
  reactionNicknames: Partial<Record<ReactionEmoji, string[]>>;
  /** The current viewer's own nickname, so an optimistic tap can add/remove them from the breakdown locally. */
  myNickname: string;
  /** Whether the winning resolution proposal has a proof photo attached. */
  hasProof: boolean;
  /** True when the viewer is a hidden subject of this market — see RevealTicket's `sealedForSubject`. */
  isSubjectOfThisMarket?: boolean;
  /** Count of non-deleted comments on this market, for the "N comments" link below the ticket. */
  commentCount: number;
}) {
  const sorted = [...bets].sort((a, b) => (b.payout ?? 0) - (a.payout ?? 0));
  const voided = headline === 'VOIDED';
  // Nobody predicted the actual outcome — every bet lost the pick, but
  // that's not the same as "lost the money": depending on distribute_payout,
  // they were either fully or partially refunded, not wiped out. Treat these
  // like a void for display purposes so nobody reads "lost" next to a bet
  // that actually came back.
  const universalLoss = !voided && bets.length > 0 && bets.every((b) => !b.isWinner);
  const refundish = voided || universalLoss;

  const detailLine =
    marketType === 'over_under' && actualValue !== null ? `Actual number: ${actualValue}.` : (justification?.trim() || null);

  // Reference-equality dedup (not id-based — RevealBet carries no id), safe since `sorted` is a
  // shallow copy of the same objects `bets` holds. Guarantees the viewer's own row always shows
  // up in "What everyone got" even when it's well outside the top payouts, without duplicating it
  // if it would have made the cut on its own.
  const myBet = bets.find((b) => b.nickname === myNickname) ?? null;
  const topOthers = sorted.filter((b) => b !== myBet).slice(0, myBet ? 2 : 3);
  const previewBets = (myBet ? [...topOthers, myBet] : topOthers).sort((a, b) => (b.payout ?? 0) - (a.payout ?? 0));
  const pool = bets.reduce((sum, b) => sum + b.amount, 0);
  const winnerCount = bets.filter((b) => b.isWinner).length;

  return (
    <div className="space-y-3">
      <RevealTicket
        groupName={groupName}
        question={question}
        resolvedAtIso={resolvedAtIso}
        headline={headline}
        isVoid={voided}
        refundish={refundish}
        detailLine={detailLine}
        line={marketType === 'over_under' && line != null ? formatLine(line, unit) : undefined}
        myBet={myBet}
        pool={pool}
        winnerCount={winnerCount}
        totalBets={bets.length}
        previewBets={previewBets}
        myNickname={myNickname}
        hiddenFrom={hiddenFrom}
        groupId={groupId}
        marketId={marketId}
        reactionCounts={reactionCounts}
        myReaction={myReaction}
        reactionNicknames={reactionNicknames}
        hasProof={hasProof}
        sealedForSubject={isSubjectOfThisMarket}
      />

      <Link
        href={`/groups/${groupId}/markets/${marketId}?tab=comments`}
        className="flex items-center justify-between gap-3 rounded-[20px] border border-hairline bg-surface px-4 py-3.5 transition-colors hover:bg-rule"
      >
        <span className="flex items-center gap-2.5 text-[14.5px] font-bold text-ink">
          <ChatIcon className="h-4 w-4 text-faint" />
          {commentCount > 0 ? `${commentCount} comment${commentCount === 1 ? '' : 's'}` : 'No comments yet'}
        </span>
        <ChevronRightIcon className="h-4 w-4 shrink-0 text-faint" />
      </Link>

      {/* One row, not three cards. The carried-bonus note, the no-winner breakdown, and the list
          of bets were each a fragment of the same question ("where did the money go?"), and none
          of them explained how the figures were reached. SettlementLedger holds all of it,
          rounding rule included, one tap away. */}
      <SettlementLedger
        bets={bets}
        payoutBreakdown={payoutBreakdown}
        carriedBonusPool={carriedBonusPool}
        creatorNickname={creatorNickname}
        sponsorNickname={sponsorNickname}
        voided={voided}
        refundish={refundish}
      />
    </div>
  );
}

