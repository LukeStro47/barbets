import { Card } from '@/components/ui/Card';
import { NeutralOddsBar, OddsBarMulti } from '@/components/markets/OddsBar';
import { OptionLabel } from '@/components/markets/OptionLabel';
import { formatTokens } from '@/lib/formatNumber';

interface SideOdds {
  side: string;
  pool_percent: number;
  pool_amount: number;
}
interface OptionOdds {
  option_id: string;
  label: string;
  pool_percent: number;
  pool_amount: number;
}
interface MyBet {
  side: string | null;
  option_id: string | null;
  amount: number;
}

/** A market's locked odds once betting's closed, plus what the viewer's own stake is worth
 * if their side lands — the same parimutuel formula finalize_market() uses
 * (floor(bet.amount * total_pool / winning_pool)), summed per individual bet the way the real
 * payout is (not floor of the combined total), so this reads as a genuine preview rather than
 * a rounded-off guess. Replaces both the odds bar and MyBetsCard for a closed, unproposed
 * market — "your position" belongs next to what it's worth, not in a separate card. */
export function FinalOddsCard({
  sideOdds,
  optionOdds,
  lineLabel,
  myBets,
}: {
  sideOdds?: SideOdds[];
  optionOdds?: OptionOdds[];
  /** over_under only: the line value, shown as the bar's center chip. */
  lineLabel?: string;
  myBets: MyBet[];
}) {
  const totalPool = sideOdds
    ? sideOdds.reduce((sum, o) => sum + o.pool_amount, 0)
    : (optionOdds ?? []).reduce((sum, o) => sum + o.pool_amount, 0);

  // Group the viewer's own bets by side/option so a hedge shows as more than one row instead
  // of a misleading single number.
  const positions = new Map<string, { label: string; amount: number; poolAmount: number }>();
  for (const bet of myBets) {
    const key = bet.side ?? bet.option_id ?? '';
    if (!key) continue;
    const poolAmount = bet.side
      ? (sideOdds?.find((o) => o.side === bet.side)?.pool_amount ?? 0)
      : (optionOdds?.find((o) => o.option_id === bet.option_id)?.pool_amount ?? 0);
    const label = bet.side ? bet.side.toUpperCase() : (optionOdds?.find((o) => o.option_id === bet.option_id)?.label ?? '?');
    const projected = poolAmount > 0 ? Math.floor((bet.amount * totalPool) / poolAmount) : 0;
    const existing = positions.get(key);
    positions.set(key, {
      label,
      amount: (existing?.amount ?? 0) + bet.amount,
      poolAmount: (existing?.poolAmount ?? 0) + projected,
    });
  }

  return (
    <Card className="!overflow-hidden !rounded-[22px] !border-[1.5px] !border-espresso-800 !p-0 shadow-[0_6px_18px_-12px_rgba(28,19,13,0.35)]">
      <div className="flex items-center justify-between bg-espresso-50 px-[18px] py-[11px]">
        <p className="text-xs font-extrabold tracking-[0.06em] text-espresso-800 uppercase">Final odds</p>
        <p className="text-xs font-semibold text-espresso-500">Locked</p>
      </div>
      <div className="space-y-3.5 px-[18px] py-4">
        {sideOdds && sideOdds.length >= 2 ? (
          <NeutralOddsBar
            left={{ label: sideOdds[0].side.toUpperCase(), percent: sideOdds[0].pool_percent }}
            right={{ label: sideOdds[1].side.toUpperCase(), percent: sideOdds[1].pool_percent }}
            center={lineLabel}
            size="lg"
          />
        ) : optionOdds && optionOdds.length > 0 ? (
          <OddsBarMulti options={optionOdds.map((o) => ({ id: o.option_id, label: o.label, percent: o.pool_percent }))} />
        ) : null}

        {positions.size > 0 && (
          <div className="space-y-2.5 border-t border-espresso-50 pt-3.5">
            {[...positions.values()].map((p, i) => (
              <div key={i} className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-[10.5px] font-extrabold tracking-[0.1em] text-espresso-400 uppercase">Your position</p>
                  <p className="mt-0.5 text-base font-extrabold text-espresso-950">
                    {formatTokens(p.amount)} on <OptionLabel label={p.label} />
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-[10.5px] font-extrabold tracking-[0.1em] text-espresso-400 uppercase">If it lands</p>
                  <p className="mt-0.5 text-base font-extrabold text-honey-800">→ {formatTokens(p.poolAmount)} back</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}
