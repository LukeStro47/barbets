import { Card } from '@/components/ui/Card';
import { NeutralOddsBar, OddsBarMulti } from '@/components/markets/OddsBar';
import { computePositions, PositionPayoutRows, type PositionBet } from '@/components/markets/PositionPayouts';

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
type MyBet = PositionBet;

/** A market's locked odds once betting's closed, plus what the viewer's own stake is worth
 * if their side lands (see computePositions for the projection itself). Replaces both the odds
 * bar and MyBetsCard for a closed, unproposed market — "your position" belongs next to what
 * it's worth, not in a separate card. */
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
  const positions = computePositions(myBets, sideOdds, optionOdds);

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

        {positions.length > 0 && (
          <div className="border-t border-espresso-50 pt-3.5">
            <PositionPayoutRows positions={positions} />
          </div>
        )}
      </div>
    </Card>
  );
}
