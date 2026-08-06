'use client';

import { useState } from 'react';
import { cn } from '@/lib/cn';
import { formatTokens } from '@/lib/formatNumber';
import type { DemoSide } from '@/lib/demoScenario';

const CHIP_AMOUNTS = [25, 50, 100];

/**
 * A trimmed, self-contained clone of the real BetslipBar's bottom-sheet UX
 * (components/markets/BetslipBar.tsx) — same slide-up sheet and confirm
 * animation, but local state only, one shot, no server action and no
 * hedging/existing-bet logic, since the demo market only ever takes one bet.
 * Controlled by the parent (isOpen/onClose) rather than owning its own
 * trigger button — the "Place a bet" CTA lives in DemoWalkthrough's fixed
 * bottom bar, and this component's sheet/confirmed overlay render as
 * top-level siblings there, not nested inside an animated per-step wrapper
 * (see the page-in-from-right note in globals.css for why a position:fixed
 * descendant of an animated ancestor would break).
 */
export function DemoBetslip({
  isOpen,
  onClose,
  balance,
  onConfirmed,
}: {
  isOpen: boolean;
  onClose: () => void;
  balance: number;
  onConfirmed: (side: DemoSide, amount: number) => void;
}) {
  const [side, setSide] = useState<DemoSide>('yes');
  const [amount, setAmount] = useState(String(CHIP_AMOUNTS[1]));
  const [confirmed, setConfirmed] = useState<{ side: DemoSide; amount: number } | null>(null);

  const amountNum = amount === '' ? 0 : Number(amount);
  const balanceAfter = Math.max(0, balance - amountNum);

  function submit() {
    onClose();
    setConfirmed({ side, amount: amountNum });
  }

  return (
    <>
      {isOpen && (
        <div className="animate-demo-fade fixed inset-0 z-40 flex items-end justify-center bg-espresso-950/45" onClick={onClose}>
          <div
            className="animate-demo-sheet-up w-full max-w-lg rounded-t-[22px] bg-gradient-to-br from-espresso-900 via-espresso-800 to-espresso-700 pb-[calc(env(safe-area-inset-bottom)+20px)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto my-2.5 h-1 w-9 rounded-full bg-white/25" />
            <div className="space-y-4 px-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-display text-base font-bold text-paper-white">Place your bet</p>
                  <p className="text-xs text-white/50">Pick a side and how much to risk.</p>
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Close"
                  className="flex h-7 w-7 items-center justify-center rounded-full bg-white/10 text-paper-white transition-colors hover:bg-white/[0.18]"
                >
                  <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
                    <path d="M1 1l12 12M13 1L1 13" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                  </svg>
                </button>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setSide('yes')}
                  className={cn(
                    'flex-1 rounded-full border py-2 text-sm font-extrabold uppercase transition-colors',
                    side === 'yes' ? 'border-honey-500 bg-honey-500/15 text-honey-300' : 'border-white/15 text-white/60'
                  )}
                >
                  Yes
                </button>
                <button
                  type="button"
                  onClick={() => setSide('no')}
                  className={cn(
                    'flex-1 rounded-full border py-2 text-sm font-extrabold uppercase transition-colors',
                    side === 'no' ? 'border-honey-500 bg-honey-500/15 text-honey-300' : 'border-white/15 text-white/60'
                  )}
                >
                  No
                </button>
              </div>

              <div>
                <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-white/50">Amount</label>
                <div className="mb-2.5 flex gap-2">
                  {CHIP_AMOUNTS.map((amt) => (
                    <button
                      key={amt}
                      type="button"
                      disabled={amt > balance}
                      onClick={() => setAmount(String(amt))}
                      className={cn(
                        'flex-1 rounded-xl border py-2 text-sm font-extrabold tabular-nums transition-colors',
                        amountNum === amt ? 'border-honey-500 bg-honey-500 text-espresso-950' : 'border-white/15 bg-white/5 text-white/75',
                        amt > balance && 'opacity-40'
                      )}
                    >
                      {formatTokens(amt)}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => setAmount(String(balance))}
                    className={cn(
                      'flex-1 rounded-xl border py-2 text-sm font-extrabold transition-colors',
                      amountNum === balance ? 'border-honey-500 bg-honey-500 text-espresso-950' : 'border-white/15 bg-white/5 text-white/75'
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
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    className="w-full rounded-xl border border-white/15 bg-white/5 px-4 py-3 pr-20 text-xl font-extrabold text-paper-white focus:border-honey-500 focus:outline-none"
                  />
                  <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-xs font-semibold text-white/50">tokens</span>
                </div>
              </div>

              <div className="space-y-1.5 border-t border-white/10 pt-3">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-sm text-white/55">Betting</span>
                  <span className="text-right text-base font-extrabold text-honey-300">
                    {formatTokens(amountNum)} tokens on {side.toUpperCase()}
                  </span>
                </div>
                <div className="flex items-baseline justify-between">
                  <span className="text-sm text-white/55">Balance after</span>
                  <span className="text-sm font-extrabold text-paper-white">{formatTokens(balanceAfter)} tokens</span>
                </div>
              </div>

              <button
                type="button"
                disabled={amountNum < 1 || amountNum > balance}
                onClick={submit}
                className="w-full rounded-full bg-honey-500 py-3.5 text-base font-extrabold text-espresso-950 transition-all duration-150 hover:bg-honey-600 active:scale-[0.97] disabled:bg-honey-500/30 disabled:text-espresso-950/40 disabled:active:scale-100"
              >
                Confirm bet
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmed && (
        <div
          className="animate-demo-fade fixed inset-0 z-50 flex flex-col items-center justify-center gap-6 bg-gradient-to-br from-espresso-900 via-espresso-800 to-espresso-700 px-8 text-center"
          style={{ animationDuration: '300ms' }}
        >
          <svg width="72" height="72" viewBox="0 0 76 76" fill="none" className="animate-bet-check-circle">
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
              {formatTokens(confirmed.amount)} tokens on {confirmed.side.toUpperCase()}
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              onConfirmed(confirmed.side, confirmed.amount);
              setConfirmed(null);
            }}
            className="mt-4 w-full max-w-xs rounded-full bg-honey-500 py-3.5 text-base font-extrabold text-espresso-950 transition-all duration-150 hover:bg-honey-600 active:scale-[0.97]"
          >
            Continue
          </button>
        </div>
      )}
    </>
  );
}
