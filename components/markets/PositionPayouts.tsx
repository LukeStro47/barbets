import { Card } from '@/components/ui/Card';
import { OptionLabel } from '@/components/markets/OptionLabel';
import { formatTokens } from '@/lib/formatNumber';

export interface PositionBet {
  side: string | null;
  option_id: string | null;
  amount: number;
}

interface SideOdds {
  side: string;
  pool_amount: number;
}
interface OptionOdds {
  option_id: string;
  label: string;
  pool_amount: number;
}

export interface Position {
  label: string;
  amount: number;
  /** What this position pays out if its side/option is the one that lands. */
  projected: number;
}

/** Groups the viewer's own bets by side/option and projects each one's payout with the exact
 * formula finalize_market() uses (floor(bet.amount * total_pool / winning_pool)), summed per
 * individual bet the way the real payout is rather than flooring the combined total, so this
 * reads as a genuine preview and not a rounded-off guess. A hedge stays split across rows
 * instead of collapsing into one misleading number. */
export function computePositions(myBets: PositionBet[], sideOdds?: SideOdds[], optionOdds?: OptionOdds[]): Position[] {
  const totalPool = sideOdds
    ? sideOdds.reduce((sum, o) => sum + o.pool_amount, 0)
    : (optionOdds ?? []).reduce((sum, o) => sum + o.pool_amount, 0);

  const positions = new Map<string, Position>();
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
      projected: (existing?.projected ?? 0) + projected,
    });
  }
  return [...positions.values()];
}

/** The "Your position → If it lands" rows themselves, with no container of their own, so they can
 * sit inside FinalOddsCard's locked-odds panel or inside the standalone card below. */
export function PositionPayoutRows({ positions }: { positions: Position[] }) {
  return (
    <div className="space-y-2.5">
      {positions.map((p, i) => (
        <div key={i} className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[10.5px] font-extrabold tracking-[0.1em] text-espresso-400 uppercase">Your position</p>
            <p className="mt-0.5 text-base font-extrabold text-espresso-950">
              {formatTokens(p.amount)} on <OptionLabel label={p.label} />
            </p>
          </div>
          <div className="text-right">
            <p className="text-[10.5px] font-extrabold tracking-[0.1em] text-espresso-400 uppercase">If it lands</p>
            <p className="mt-0.5 text-base font-extrabold text-honey-800">&rarr; {formatTokens(p.projected)} back</p>
          </div>
        </div>
      ))}
    </div>
  );
}

/** Standalone version for the market states where betting is already locked but there's no
 * FinalOddsCard on screen to host it (proposed, disputed) — the odds bar is already being shown
 * elsewhere on those pages, so this carries only the part that's genuinely missing: what the
 * viewer's own stake is actually worth. Renders nothing when they never bet, or when there's no
 * pool data to project against. */
export function YourPositionCard({
  myBets,
  sideOdds,
  optionOdds,
}: {
  myBets: PositionBet[];
  sideOdds?: SideOdds[];
  optionOdds?: OptionOdds[];
}) {
  const positions = computePositions(myBets, sideOdds, optionOdds);
  if (positions.length === 0) return null;

  return (
    <Card className="space-y-2.5">
      <PositionPayoutRows positions={positions} />
      <p className="text-xs text-espresso-400">
        Based on the pool as it locked. The exact number can still change if this market ends up voided or refunded.
      </p>
    </Card>
  );
}
