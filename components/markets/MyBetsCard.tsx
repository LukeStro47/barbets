import { Card } from '@/components/ui/Card';
import { OptionLabel } from '@/components/markets/OptionLabel';
import { formatTokens } from '@/lib/formatNumber';

interface MyBet {
  side: string | null;
  option_id: string | null;
  amount: number;
}

/** Your own stake is always visible to you even while the market's otherwise sealed, so it earns its own card rather than a small aside, with the total staked called out big. */
export function MyBetsCard({ bets, optionLabelById }: { bets: MyBet[]; optionLabelById: (id: string) => string }) {
  if (bets.length === 0) return null;
  const total = bets.reduce((sum, b) => sum + b.amount, 0);

  return (
    <Card className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-espresso-700">Your bets on this market</p>
          <p className="text-xs text-espresso-400">
            {bets.length} {bets.length === 1 ? 'bet' : 'bets'} placed
          </p>
        </div>
        <div className="text-right">
          <p className="font-display text-2xl font-bold text-honey-700">{formatTokens(total)}</p>
          <p className="text-xs text-espresso-400">tokens staked</p>
        </div>
      </div>
      <ul className="space-y-1.5">
        {bets.map((b, i) => (
          <li key={i} className="flex items-center justify-between rounded-xl bg-honey-50 px-3 py-2 text-sm">
            <span className="font-bold text-honey-800">
              <OptionLabel label={(b.option_id ? optionLabelById(b.option_id) : b.side ?? '').toUpperCase()} />
            </span>
            <span className="font-semibold text-espresso-800">{formatTokens(b.amount)} tokens</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
