'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { placeBet } from '@/lib/actions/bets';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { OptionLabel } from '@/components/markets/OptionLabel';
import type { Market, MarketOption } from '@/lib/actions/markets';
import { formatTokens } from '@/lib/formatNumber';

const inputClasses =
  'w-full rounded-xl border border-espresso-200 bg-paper-white px-4 py-2.5 text-espresso-900 focus:border-honey-500 focus:outline-none focus:ring-2 focus:ring-honey-200';

/** The single most important action on an open market's page, so it renders as the very first card, above even the resolution criteria. */
export function PlaceBetCard({
  groupId,
  market,
  balance,
  options,
}: {
  groupId: string;
  market: Market;
  balance: number;
  options: MarketOption[] | null;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const isMultipleChoice = market.market_type === 'multiple_choice';
  const sides = market.market_type === 'yes_no' ? (['yes', 'no'] as const) : (['over', 'under'] as const);
  const [betSide, setBetSide] = useState<'yes' | 'no' | 'over' | 'under'>(sides[0]);
  const [betOptionId, setBetOptionId] = useState<string | null>(null);
  // A string, not a number: keeping the field's default of 10 as a
  // placeholder rather than a real value means an empty input stays
  // genuinely empty (no forced "0" flashing back in after a backspace on
  // mobile numeric keypads, which was hard to clear past).
  const [betAmount, setBetAmount] = useState('');
  const betAmountNum = betAmount === '' ? 0 : Number(betAmount);

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await placeBet(groupId, market.id, betAmountNum, isMultipleChoice ? { optionId: betOptionId! } : { side: betSide });
      if (result.error) {
        setError(result.error);
      } else {
        router.refresh();
      }
    });
  }

  return (
    <Card className="space-y-3">
      <p className="text-sm font-semibold text-espresso-700">Place your bet</p>
      {error && <p className="text-sm text-danger-700">{error}</p>}

      {isMultipleChoice ? (
        <div className="flex flex-col gap-2">
          {(options ?? []).map((o) => (
            <button
              key={o.id}
              type="button"
              onClick={() => setBetOptionId(o.id)}
              className={`rounded-xl border px-4 py-2 text-left text-sm font-bold ${
                betOptionId === o.id ? 'border-honey-500 bg-honey-50 text-honey-800' : 'border-espresso-200 text-espresso-500'
              }`}
            >
              <OptionLabel label={o.label} />
            </button>
          ))}
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setBetSide(sides[0])}
            className={`flex-1 rounded-full border py-2 text-sm font-bold uppercase ${
              betSide === sides[0] ? 'border-honey-500 bg-honey-50 text-honey-800' : 'border-espresso-200 text-espresso-500'
            }`}
          >
            {sides[0]}
          </button>
          <button
            type="button"
            onClick={() => setBetSide(sides[1])}
            className={`flex-1 rounded-full border py-2 text-sm font-bold uppercase ${
              betSide === sides[1] ? 'border-honey-500 bg-honey-50 text-honey-800' : 'border-espresso-200 text-espresso-500'
            }`}
          >
            {sides[1]}
          </button>
        </div>
      )}

      <div className="space-y-1.5 border-t border-espresso-100 pt-3">
        <label className="block text-xs font-semibold uppercase tracking-wide text-espresso-400">Your bet</label>
        <div className="relative">
          <input
            type="number"
            min={1}
            max={balance}
            value={betAmount}
            onChange={(e) => setBetAmount(e.target.value)}
            placeholder={String(Math.min(balance, 10))}
            className={`${inputClasses} pr-20`}
          />
          <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-sm font-semibold text-espresso-400">
            tokens
          </span>
        </div>
        <p className="text-xs text-espresso-400">Your balance: {formatTokens(balance)} tokens</p>
      </div>

      <Button
        disabled={isPending || betAmountNum < 1 || betAmountNum > balance || (isMultipleChoice && !betOptionId)}
        onClick={submit}
        className="w-full"
        variant="accent"
      >
        Place bet
      </Button>
    </Card>
  );
}
