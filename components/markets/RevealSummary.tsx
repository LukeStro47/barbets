import Link from 'next/link';
import { RevealTicket } from '@/components/markets/RevealTicket';
import { SettlementLedger } from '@/components/markets/SettlementLedger';
import { UserAvatar } from '@/components/ui/UserAvatar';
import { RowChevron } from '@/components/ui/Screen';
import type { PayoutBreakdown } from '@/lib/actions/markets';
import { formatLine } from '@/lib/units';

export interface RevealBet {
  nickname: string;
  userId?: string;
  avatarUpdatedAt?: string | null;
  avatarPresetKey?: string | null;
  /** Precomputed by the caller: the bet_side or the option's label, whichever applies. */
  choiceLabel: string;
  amount: number;
  payout: number | null;
  /** Compared against the actual outcome by the caller — not inferred from payout, since a winning bet can floor to 0. */
  isWinner: boolean;
}

export interface LatestComment {
  userId: string;
  nickname: string;
  avatarUpdatedAt: string | null;
  avatarPresetKey: string | null;
  body: string;
}

/** 4m's stack under the title: the result, your result, what everyone got (with the ledger at its
 *  foot), then the latest comment and a link into the thread. */
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
  justification,
  hiddenFrom,
  groupId,
  marketId,
  myNickname,
  hasProof,
  isSubjectOfThisMarket,
  commentCount,
  latestComment,
  calledByNickname,
}: {
  groupName: string;
  question: string;
  headline: string;
  actualValue: number | null;
  marketType: 'yes_no' | 'over_under' | 'multiple_choice';
  line?: number | null;
  unit?: string | null;
  bets: RevealBet[];
  payoutBreakdown?: PayoutBreakdown | null;
  carriedBonusPool?: number;
  creatorNickname?: string;
  sponsorNickname?: string;
  justification?: string | null;
  hiddenFrom: string[];
  groupId: string;
  marketId: string;
  myNickname: string;
  hasProof: boolean;
  isSubjectOfThisMarket?: boolean;
  commentCount: number;
  latestComment?: LatestComment | null;
  calledByNickname?: string;
}) {
  const sorted = [...bets].sort((a, b) => (b.payout ?? 0) - (a.payout ?? 0));
  const voided = headline === 'VOIDED';
  // Nobody predicted the outcome: every pick lost, but the stakes came back (fully or partly),
  // so it reads like a void rather than "lost" next to money that returned.
  const universalLoss = !voided && bets.length > 0 && bets.every((b) => !b.isWinner);
  const refundish = voided || universalLoss;

  const detailLine = marketType === 'over_under' && actualValue !== null ? `Actual ${actualValue}` : justification?.trim() || null;

  const myBet = bets.find((b) => b.nickname === myNickname) ?? null;
  const topOthers = sorted.filter((b) => b !== myBet).slice(0, myBet ? 2 : 3);
  const previewBets = (myBet ? [myBet, ...topOthers] : topOthers).sort((a, b) => (a === myBet ? -1 : b === myBet ? 1 : 0));
  const pool = bets.reduce((sum, b) => sum + b.amount, 0);
  const winnerCount = bets.filter((b) => b.isWinner).length;
  const commentsHref = `/groups/${groupId}/markets/${marketId}?tab=comments`;

  return (
    <div className="flex flex-col gap-[11px]">
      <RevealTicket
        groupName={groupName}
        question={question}
        headline={headline}
        isVoid={voided}
        refundish={refundish}
        detailLine={detailLine}
        line={marketType === 'over_under' && line != null ? formatLine(line, unit) : undefined}
        myBet={myBet}
        pool={pool}
        winnerCount={winnerCount}
        previewBets={previewBets}
        myNickname={myNickname}
        hiddenFrom={hiddenFrom}
        groupId={groupId}
        marketId={marketId}
        hasProof={hasProof}
        sealedForSubject={isSubjectOfThisMarket}
        proofByNickname={calledByNickname}
        ledger={
          <SettlementLedger
            variant="link"
            bets={bets}
            payoutBreakdown={payoutBreakdown}
            carriedBonusPool={carriedBonusPool}
            creatorNickname={creatorNickname}
            sponsorNickname={sponsorNickname}
            voided={voided}
            refundish={refundish}
          />
        }
      />

      {latestComment ? (
        <div className="rounded-2xl border border-hairline bg-surface px-[15px] py-3">
          <div className="flex gap-2.5">
            <UserAvatar
              userId={latestComment.userId}
              nickname={latestComment.nickname}
              avatarUpdatedAt={latestComment.avatarUpdatedAt}
              avatarPresetKey={latestComment.avatarPresetKey}
              className="h-[26px] w-[26px] text-[10px]"
              fallbackClassName="bg-tile text-muted"
            />
            <span className="min-w-0 flex-1">
              <span className="block text-[12.5px] font-bold text-ink">@{latestComment.nickname}</span>
              <span className="mt-0.5 line-clamp-3 block text-[13px] leading-[1.45] text-muted text-pretty">{latestComment.body}</span>
            </span>
          </div>
          <Link href={commentsHref} className="mt-2.5 flex items-center justify-between gap-2.5 border-t border-rule pt-[9px]">
            <span className="text-[12px] font-bold text-signal">
              Read all {commentCount} comment{commentCount === 1 ? '' : 's'}
            </span>
            <RowChevron className="text-signal" />
          </Link>
        </div>
      ) : (
        <Link href={commentsHref} className="flex items-center justify-between gap-2.5 rounded-2xl border border-hairline bg-surface px-[15px] py-3">
          <span className="text-[12px] font-bold text-signal">No comments yet. Say something</span>
          <RowChevron className="text-signal" />
        </Link>
      )}
    </div>
  );
}
