import { RevealTicket, type TicketOddsEntry } from '@/components/markets/RevealTicket';
import { OptionLabel } from '@/components/markets/OptionLabel';
import { ReactionBar } from '@/components/markets/ReactionBar';
import { Mention } from '@/components/ui/Mention';
import { Card } from '@/components/ui/Card';
import type { PayoutBreakdown } from '@/lib/actions/markets';
import type { ReactionEmoji } from '@/lib/actions/reactions';

export interface RevealBet {
  nickname: string;
  /** Precomputed by the caller: the bet_side or the option's label, whichever applies. */
  choiceLabel: string;
  amount: number;
  payout: number | null;
  /** Precomputed by the caller by comparing this bet's side/option to the market's actual outcome — not inferred from payout, since a winning bet can still floor to a $0 payout. */
  isWinner: boolean;
}

function BreakdownRow({ label, amount }: { label: React.ReactNode; amount: number }) {
  if (amount <= 0) return null;
  return (
    <div className="flex items-center justify-between">
      <span>{label}</span>
      <span className="font-semibold text-espresso-800">{amount} tokens</span>
    </div>
  );
}

export function RevealSummary({
  groupName,
  question,
  headline,
  actualValue,
  marketType,
  line,
  bets,
  odds,
  optionOdds,
  payoutBreakdown,
  creatorNickname,
  sponsorNickname,
  resolvedAtIso,
  justification,
  hiddenFrom,
  groupId,
  marketId,
  reactionCounts,
  myReaction,
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
  bets: RevealBet[];
  /** yes_no/over_under only. */
  odds?: { side: string; percent: number }[];
  /** multiple_choice only. isWinner precomputed by the caller against outcome_option_id. */
  optionOdds?: { id: string; label: string; percent: number; isWinner: boolean }[];
  /** Only set when nobody predicted the outcome and the group has distribute_payout on. */
  payoutBreakdown?: PayoutBreakdown | null;
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
}) {
  const [sideA, sideB] = marketType === 'yes_no' ? ['yes', 'no'] : ['over', 'under'];
  const oddsA = odds?.find((o) => o.side === sideA);
  const oddsB = odds?.find((o) => o.side === sideB);
  const sorted = [...bets].sort((a, b) => (b.payout ?? 0) - (a.payout ?? 0));
  const voided = headline === 'VOIDED';
  // Nobody predicted the actual outcome — every bet lost the pick, but
  // that's not the same as "lost the money": depending on distribute_payout,
  // they were either fully or partially refunded, not wiped out. Treat these
  // like a void for display purposes so nobody reads "lost" next to a bet
  // that actually came back.
  const universalLoss = !voided && bets.length > 0 && bets.every((b) => !b.isWinner);
  const refundish = voided || universalLoss;

  const ticketOdds: TicketOddsEntry[] =
    marketType === 'multiple_choice'
      ? [...(optionOdds ?? [])].sort((a, b) => b.percent - a.percent).map((o) => ({ label: o.label, percent: o.percent, isWinner: o.isWinner }))
      : oddsA && oddsB
        ? [
            { label: sideA.toUpperCase(), percent: oddsA.percent },
            { label: sideB.toUpperCase(), percent: oddsB.percent },
          ]
        : [];

  const winnerPercent = voided
    ? null
    : marketType === 'multiple_choice'
      ? (optionOdds?.find((o) => o.isWinner)?.percent ?? null)
      : (odds?.find((o) => o.side === headline.toLowerCase())?.percent ?? null);

  const detailLine =
    marketType === 'over_under' && actualValue !== null ? `Actual number: ${actualValue}.` : (justification?.trim() || null);

  const callers = sorted
    .filter((b) => b.isWinner)
    .slice(0, 3)
    .map((b) => ({ nickname: b.nickname, amount: b.amount, payout: b.payout ?? 0 }));

  return (
    <div className="space-y-6">
      <RevealTicket
        groupName={groupName}
        question={question}
        resolvedAtIso={resolvedAtIso}
        headline={headline}
        isVoid={voided}
        isMultipleChoice={marketType === 'multiple_choice'}
        detailLine={detailLine}
        line={marketType === 'over_under' ? (line ?? undefined) : undefined}
        odds={ticketOdds}
        winnerPercent={winnerPercent}
        callers={callers}
        hiddenFrom={hiddenFrom}
      />

      <ReactionBar groupId={groupId} marketId={marketId} counts={reactionCounts} myReaction={myReaction} />

      {payoutBreakdown && (
        <Card className="space-y-2">
          <p className="text-sm font-semibold text-espresso-800">Nobody predicted this one, so the pool was split</p>
          <div className="space-y-1 text-sm text-espresso-600">
            <BreakdownRow
              label={<>Creator {creatorNickname && <Mention nickname={creatorNickname} />}</>}
              amount={payoutBreakdown.creator_cut}
            />
            <BreakdownRow
              label={<>Endorser {sponsorNickname && <Mention nickname={sponsorNickname} />}</>}
              amount={payoutBreakdown.endorser_cut}
            />
            <BreakdownRow label="Split into the group's other open markets" amount={payoutBreakdown.other_markets_cut} />
            <BreakdownRow label="Refunded back to bettors" amount={payoutBreakdown.refunded_to_bettors} />
            <BreakdownRow label="Settled to the group owner" amount={payoutBreakdown.settled_to_owner} />
          </div>
        </Card>
      )}

      <div className="space-y-2">
        <div className="mx-0.5 flex items-baseline justify-between">
          <h2 className="text-[13px] font-extrabold tracking-[0.06em] text-espresso-400 uppercase">Full ledger</h2>
          {bets.length > 0 && <span className="text-xs text-espresso-400">{bets.length} bet{bets.length === 1 ? '' : 's'}</span>}
        </div>
        {sorted.length === 0 && <p className="text-sm text-espresso-400">Nobody bet on this one.</p>}
        {sorted.length > 0 && (
          <ul className="overflow-hidden rounded-[20px] border border-espresso-100 bg-paper-white">
            {sorted.map((b, i) => {
              const won = !refundish && b.isWinner;
              const lost = !refundish && !b.isWinner;
              const winnings = won ? (b.payout ?? 0) - b.amount : 0;

              return (
                <li
                  key={i}
                  className={`flex items-center justify-between gap-2.5 px-4 py-3 ${i > 0 ? 'border-t border-espresso-100' : ''}`}
                >
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span className={`h-2 w-2 shrink-0 rounded-full ${won ? 'bg-success-500' : 'bg-espresso-200'}`} />
                    <div className="min-w-0">
                      <Mention nickname={b.nickname} className="text-[14.5px] font-bold text-espresso-800" />
                      <p className="truncate text-[12.5px] text-espresso-400">
                        Bet {b.amount} on <OptionLabel label={b.choiceLabel.toUpperCase()} />
                      </p>
                    </div>
                  </div>
                  <div className="shrink-0 text-right text-[14.5px] font-extrabold">
                    {refundish && (
                      <span className="text-espresso-500">
                        {b.payout === b.amount ? `↩ refunded ${b.payout}` : b.payout && b.payout > 0 ? `↩ ${b.payout} back` : 'nothing back'}
                      </span>
                    )}
                    {won && (
                      <>
                        <p className="text-success-700">+{winnings} won</p>
                        <p className="text-[11px] font-semibold text-espresso-400">{b.payout} back total</p>
                      </>
                    )}
                    {lost && <span className="font-bold text-espresso-300">−{b.amount} lost</span>}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

