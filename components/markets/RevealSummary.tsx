import { OddsBar, OddsBarMulti, type OddsOption } from '@/components/markets/OddsBar';
import { OptionLabel } from '@/components/markets/OptionLabel';
import { Mention } from '@/components/ui/Mention';
import { Card } from '@/components/ui/Card';
import type { PayoutBreakdown } from '@/lib/actions/markets';

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
}: {
  /** Precomputed by the caller: 'VOIDED', a bet_side in caps, or the winning option's label. */
  headline: string;
  actualValue: number | null;
  marketType: 'yes_no' | 'over_under' | 'multiple_choice';
  /** over_under only. */
  line?: number | null;
  bets: RevealBet[];
  /** yes_no/over_under only. */
  odds?: { side: string; percent: number }[];
  /** multiple_choice only. */
  optionOdds?: OddsOption[];
  /** Only set when nobody predicted the outcome and the group has distribute_payout on. */
  payoutBreakdown?: PayoutBreakdown | null;
  creatorNickname?: string;
  sponsorNickname?: string;
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

  return (
    <div className="space-y-6">
      <div className="rounded-3xl bg-espresso-900 px-6 py-8 text-center text-paper-white">
        <p className="text-sm font-medium uppercase tracking-widest text-honey-400">The reveal</p>
        <p className="mt-2 font-display text-4xl font-bold">
          <OptionLabel label={headline} />
        </p>
        {actualValue !== null && <p className="mt-1 text-espresso-200">Actual number: {actualValue}</p>}
        {marketType !== 'multiple_choice' && oddsA && oddsB && (
          <div className="mx-auto mt-6 max-w-xs text-left">
            <OddsBar
              left={{ label: sideA.toUpperCase(), percent: oddsA.percent }}
              right={{ label: sideB.toUpperCase(), percent: oddsB.percent }}
              center={marketType === 'over_under' ? line ?? undefined : undefined}
            />
          </div>
        )}
        {marketType === 'multiple_choice' && optionOdds && optionOdds.length > 0 && (
          <div className="mx-auto mt-6 max-w-xs text-left">
            <OddsBarMulti options={optionOdds} />
          </div>
        )}
      </div>

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
        <h2 className="font-display font-bold text-espresso-800">Who bet what</h2>
        {sorted.length === 0 && <p className="text-sm text-espresso-400">Nobody bet on this one.</p>}
        {sorted.map((b, i) => {
          const won = !refundish && b.isWinner;
          const lost = !refundish && !b.isWinner;
          const winnings = won ? (b.payout ?? 0) - b.amount : 0;

          return (
            <div key={i} className="flex items-center justify-between rounded-xl border border-espresso-100 bg-paper-white px-4 py-3">
              <div>
                <p>
                  <Mention nickname={b.nickname} className="font-semibold text-espresso-800" />
                </p>
                <p className="text-sm text-espresso-400">
                  bet {b.amount} on <OptionLabel label={b.choiceLabel.toUpperCase()} />
                </p>
              </div>
              <div className="text-right">
                {refundish && (
                  <p className="font-display font-bold text-espresso-500">
                    {b.payout === b.amount
                      ? `↩ refunded ${b.payout}`
                      : b.payout && b.payout > 0
                        ? `↩ ${b.payout} back`
                        : 'nothing back'}
                  </p>
                )}
                {won && (
                  <>
                    <p className="font-display font-bold text-honey-600">+{winnings} won</p>
                    <p className="text-xs text-espresso-400">{b.payout} back total</p>
                  </>
                )}
                {lost && <p className="font-display font-bold text-espresso-300">−{b.amount} lost</p>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
