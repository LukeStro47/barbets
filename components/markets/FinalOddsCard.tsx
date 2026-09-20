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
    <Card className="!overflow-hidden !p-0 !shadow-none">
      <div className="flex items-center justify-between border-b border-hairline px-4 py-3">
        <p className="text-[11.5px] font-bold tracking-[0.1em] text-faint uppercase">Final odds</p>
        <p className="font-mono text-[12.5px] font-semibold text-muted">Locked</p>
      </div>
      <div className="space-y-3.5 px-4 py-4">
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
          <div className="border-t border-hairline pt-3.5">
            <PositionPayoutRows positions={positions} />
          </div>
        )}
      </div>
    </Card>
  );
}
