'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { placeBet } from '@/lib/actions/bets';
import { OptionLabel } from '@/components/markets/OptionLabel';
import { cn } from '@/lib/cn';
import { formatTokens } from '@/lib/formatNumber';
import type { Market, MarketOption } from '@/lib/actions/markets';

interface ExistingBet {
  side: string | null;
  option_id: string | null;
  amount: number;
}

/** Nearest multiple of 5, floored at 5 so a tiny seed amount never rounds a quick-amount chip down to 0. */
function roundToFive(n: number): number {
  return Math.max(5, Math.round(n / 5) * 5);
}

/** The persistent bottom betslip: a ticket-styled bar that slides up into a confirmation sheet, replacing the old inline PlaceBetCard as the one way to bet on an open market. */
export function BetslipBar({
  groupId,
  market,
  balance,
  options,
  existingBets = [],
  allowHedgedBets = true,
  seedAmount,
  betCount,
  betVolume,
}: {
  groupId: string;
  market: Market;
  balance: number;
  options: MarketOption[] | null;
  existingBets?: ExistingBet[];
  allowHedgedBets?: boolean;
  /** group_settings.seed_amount — the tokens a new member starts with, used as the base for quick-amount chips. */
  seedAmount: number;
  betCount: number | null;
  betVolume: number | null;
}) {
  const router = useRouter();
  const isMultipleChoice = market.market_type === 'multiple_choice';
  const sides = market.market_type === 'yes_no' ? (['yes', 'no'] as const) : (['over', 'under'] as const);

  const existingSide = existingBets.find((b) => b.side)?.side as (typeof sides)[number] | undefined;
  const existingOptionId = existingBets.find((b) => b.option_id)?.option_id;

  const [isOpen, setIsOpen] = useState(false);
  const [betSide, setBetSide] = useState<(typeof sides)[number]>(existingSide ?? sides[0]);
  const [betOptionId, setBetOptionId] = useState<string | null>(existingOptionId ?? options?.[0]?.id ?? null);
  const defaultAmount = Math.min(balance, roundToFive(seedAmount * 0.05));
  const [betAmount, setBetAmount] = useState(defaultAmount > 0 ? String(defaultAmount) : '');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [confirmed, setConfirmed] = useState<{ amount: number; label: string } | null>(null);

  const betAmountNum = betAmount === '' ? 0 : Number(betAmount);
  const balanceAfter = Math.max(0, balance - betAmountNum);
  const hasExisting = existingBets.length > 0;

  const conflictsWithExisting = existingBets.some((b) => (isMultipleChoice ? b.option_id !== betOptionId : b.side !== betSide));
  const blockedByHedgeSetting = !allowHedgedBets && hasExisting && conflictsWithExisting;

  const chipAmounts = [0.01, 0.05, 0.1].map((pct) => roundToFive(seedAmount * pct));

  const subtitle =
    betCount === null || betCount === 0
      ? 'Be the first to bet'
      : `${betCount} ${betCount === 1 ? 'bet' : 'bets'} · ${formatTokens(betVolume ?? 0)} tokens`;

  const selectedLabel = isMultipleChoice ? (options?.find((o) => o.id === betOptionId)?.label ?? '') : betSide.toUpperCase();

  useEffect(() => {
    if (!isOpen) return;
    document.body.style.overflow = 'hidden';
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setIsOpen(false);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = '';
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [isOpen]);

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await placeBet(groupId, market.id, betAmountNum, isMultipleChoice ? { optionId: betOptionId! } : { side: betSide });
      if (result.error) {
        setError(result.error);
        return;
      }
      setIsOpen(false);
      setConfirmed({ amount: betAmountNum, label: selectedLabel });
    });
  }

  function dismissConfirmation() {
    setConfirmed(null);
    router.refresh();
  }

  return (
    <>
      {/* In-flow, invisible twin of the bar below — reserves exactly the bar's real rendered
          height at the end of the page, instead of a guessed padding value that drifts out of
          sync with the bar's actual size and leaves a visible gap above it. */}
      <div aria-hidden="true" className="invisible pb-[env(safe-area-inset-bottom)]">
        <div className="w-full px-5 py-4">
          <div className="mx-auto flex max-w-lg items-center justify-between">
            <div>
              <p className="text-base font-bold">{hasExisting ? 'Add to your bet' : 'Place a bet'}</p>
              <p className="text-xs">{subtitle}</p>
            </div>
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full" />
          </div>
        </div>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-30 rounded-t-[20px] bg-gradient-to-br from-espresso-900 via-espresso-800 to-espresso-700 pb-[env(safe-area-inset-bottom)] shadow-[0_-14px_28px_-10px_rgba(28,19,13,0.4)]">
        <button type="button" onClick={() => setIsOpen(true)} className="w-full px-5 py-4 text-left">
          <div className="mx-auto flex max-w-lg items-center justify-between">
            <div>
              <p className="text-base font-bold text-paper-white">{hasExisting ? 'Add to your bet' : 'Place a bet'}</p>
              <p className="text-xs text-paper-white/60">{subtitle}</p>
            </div>
            <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-honey-500 transition-transform', isOpen && 'rotate-180')}>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M4 10l4-4 4 4" stroke="#1c130d" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
          </div>
        </button>
      </div>

      {isOpen && <div className="fixed inset-0 z-40 bg-espresso-950/45" onClick={() => setIsOpen(false)} />}

      <div
        className={cn(
          'fixed inset-x-0 bottom-0 z-50 max-h-[85dvh] overflow-y-auto rounded-t-[22px] bg-gradient-to-br from-espresso-900 via-espresso-800 to-espresso-700 pb-[calc(env(safe-area-inset-bottom)+20px)] transition-transform duration-300 ease-out',
          isOpen ? 'translate-y-0' : 'translate-y-full'
        )}
        aria-hidden={!isOpen}
      >
        <div className="mx-auto my-2.5 h-1 w-9 rounded-full bg-white/25" />
        <div className="mx-auto max-w-lg space-y-4 px-5">
          <div className="flex items-center justify-between">
            <p className="font-display text-base font-bold text-paper-white">Place your bet</p>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              aria-label="Close"
              className="flex h-7 w-7 items-center justify-center rounded-full bg-white/10 text-paper-white"
            >
              <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
                <path d="M1 1l12 12M13 1L1 13" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
            </button>
          </div>

          {error && <p className="text-sm font-semibold text-danger-100">{error}</p>}
          {blockedByHedgeSetting && (
            <p className="text-sm font-semibold text-danger-100">
              This group only allows one side per market, and you already have a bet on the other side. You can still add to
              your existing bet.
            </p>
          )}

          {isMultipleChoice ? (
            <div className="flex flex-col gap-2">
              {(options ?? []).map((o) => (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => setBetOptionId(o.id)}
                  className={cn(
                    'rounded-xl border px-4 py-2 text-left text-sm font-bold',
                    betOptionId === o.id ? 'border-honey-500 bg-honey-500/15 text-honey-300' : 'border-white/15 text-white/60'
                  )}
                >
                  <OptionLabel label={o.label} />
                </button>
              ))}
            </div>
          ) : (
            <div className="flex items-center gap-2">
              {sides.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setBetSide(s)}
                  className={cn(
                    'flex-1 rounded-full border py-2 text-sm font-bold uppercase',
                    betSide === s ? 'border-honey-500 bg-honey-500/15 text-honey-300' : 'border-white/15 text-white/60'
                  )}
                >
                  {s}
                </button>
              ))}
            </div>
          )}

          <div>
            <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-white/50">Amount</label>
            <div className="mb-2.5 flex gap-2">
              {chipAmounts.map((amt) => (
                <button
                  key={amt}
                  type="button"
                  disabled={amt < 1 || amt > balance}
                  onClick={() => setBetAmount(String(amt))}
                  className={cn(
                    'flex-1 rounded-xl border py-2 text-sm font-bold tabular-nums',
                    betAmountNum === amt ? 'border-honey-500 bg-honey-500 text-espresso-950' : 'border-white/15 bg-white/5 text-white/75',
                    (amt < 1 || amt > balance) && 'opacity-40'
                  )}
                >
                  {formatTokens(amt)}
                </button>
              ))}
              <button
                type="button"
                disabled={balance < 1}
                onClick={() => setBetAmount(String(balance))}
                className={cn(
                  'flex-1 rounded-xl border py-2 text-sm font-bold',
                  betAmountNum === balance && balance > 0 ? 'border-honey-500 bg-honey-500 text-espresso-950' : 'border-white/15 bg-white/5 text-white/75',
                  balance < 1 && 'opacity-40'
                )}
              >
                Max
              </button>
            </div>
            <div className="relative">
              <input
                type="number"
                min={1}
                max={balance}
                value={betAmount}
                onChange={(e) => setBetAmount(e.target.value)}
                className="w-full rounded-xl border border-white/15 bg-white/5 px-4 py-3 pr-20 text-xl font-bold text-paper-white focus:border-honey-500 focus:outline-none"
              />
              <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-xs font-semibold text-white/50">tokens</span>
            </div>
          </div>

          <div className="space-y-1.5 border-t border-white/10 pt-3">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-sm text-white/55">Betting</span>
              <span className="text-right text-base font-bold text-honey-300">
                {formatTokens(betAmountNum)} tokens on <OptionLabel label={selectedLabel.toUpperCase()} />
              </span>
            </div>
            <div className="flex items-baseline justify-between">
              <span className="text-sm text-white/55">Balance after</span>
              <span className="text-sm font-bold text-paper-white">{formatTokens(balanceAfter)} tokens</span>
            </div>
          </div>

          <button
            type="button"
            disabled={isPending || betAmountNum < 1 || betAmountNum > balance || (isMultipleChoice && !betOptionId) || blockedByHedgeSetting}
            onClick={submit}
            className="w-full rounded-full bg-honey-500 py-3.5 text-base font-bold text-espresso-950 transition-colors hover:bg-honey-600 disabled:bg-honey-500/30 disabled:text-espresso-950/40"
          >
            Confirm bet
          </button>
        </div>
      </div>

      {confirmed && <BetConfirmedOverlay amount={confirmed.amount} label={confirmed.label} onClose={dismissConfirmation} />}
    </>
  );
}

function BetConfirmedOverlay({ amount, label, onClose }: { amount: number; label: string; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[60] flex flex-col items-center justify-center gap-6 bg-gradient-to-br from-espresso-900 via-espresso-800 to-espresso-700 px-8 text-center">
      <svg width="76" height="76" viewBox="0 0 76 76" fill="none" className="animate-bet-check-circle">
        <circle cx="38" cy="38" r="36" className="fill-honey-500" />
        <path
          d="M24 39l9 9 19-19"
          className="animate-bet-check-mark"
          stroke="#1c130d"
          strokeWidth="5"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      </svg>
      <div className="space-y-1.5">
        <p className="font-display text-2xl font-bold text-paper-white">Bet placed</p>
        <p className="text-base text-paper-white/70">
          {formatTokens(amount)} tokens on <OptionLabel label={label.toUpperCase()} />
        </p>
      </div>
      <button
        type="button"
        onClick={onClose}
        className="mt-4 w-full max-w-xs rounded-full bg-honey-500 py-3.5 text-base font-bold text-espresso-950 transition-colors hover:bg-honey-600"
      >
        Close
      </button>
    </div>
  );
}
