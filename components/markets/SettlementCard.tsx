import { Card } from '@/components/ui/Card';
import { NeutralOddsBar } from '@/components/markets/OddsBar';

interface SideShare {
  label: string;
  percent: number;
}

/** "Where the money sat" (optional — the voting screen only, since the market-closed screen
 * already shows odds in FinalOddsCard) + "How this settles," the market's resolution
 * criteria moved here from its own standalone card once a market's past the betting stage,
 * where the metadata chips (started by/endorsed by/hidden from) stop being the thing anyone
 * actually needs. */
export function SettlementCard({ moneySplit, description }: { moneySplit?: [SideShare, SideShare]; description: string }) {
  return (
    <Card className="space-y-3.5">
      {moneySplit && (
        <div>
          <p className="mb-2 text-[11.5px] font-extrabold tracking-[0.08em] text-espresso-400 uppercase">Where the money sat</p>
          <NeutralOddsBar left={moneySplit[0]} right={moneySplit[1]} size="sm" />
        </div>
      )}
      <div>
        <p className="mb-1 text-[11.5px] font-extrabold tracking-[0.08em] text-espresso-400 uppercase">How this settles</p>
        <p className="text-[14.5px] leading-[1.45] text-espresso-700">{description}</p>
      </div>
    </Card>
  );
}
