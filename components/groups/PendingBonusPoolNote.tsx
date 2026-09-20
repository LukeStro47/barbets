'use client';

import { useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { formatTokens } from '@/lib/formatNumber';

/** groups.pending_bonus_pool: money from a universal-loss market that hasn't found a next market to
    seed yet (none were open at the time), holding at the group level instead of a specific market's
    bonus_pool. Surfaced here since it's otherwise invisible until it lands on a market — same
    tap-to-explain treatment, and the same banded explainer panel, as BonusPoolValue. */
export function PendingBonusPoolNote({ amount }: { amount: number }) {
  const [showInfo, setShowInfo] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setShowInfo(true)}
        className="flex w-full items-center gap-2.5 rounded-2xl border border-signal/60 bg-signal-tint px-4 py-3 text-left"
      >
        <span className="text-lg leading-none">🎁</span>
        <span className="min-w-0 flex-1 text-sm font-semibold text-muted">
          {formatTokens(amount)} tokens waiting for the next market
        </span>
        <span className="shrink-0 text-xs font-bold text-faint underline decoration-dotted underline-offset-2">Why?</span>
      </button>
      {showInfo && (
        <Modal onClose={() => setShowInfo(false)} padded={false} panelClassName="overflow-hidden">
          <div className="flex items-center justify-between gap-3 bg-rule px-[18px] py-[13px]">
            <p className="text-xs font-extrabold tracking-[0.06em] text-ink uppercase">Bonus pool</p>
            <p className="shrink-0 text-xs font-semibold text-muted">{formatTokens(amount)} tokens</p>
          </div>

          <div className="flex flex-col gap-3 p-[18px]">
            <p className="font-display text-[19px] font-extrabold tracking-[-0.01em] text-ink">
              Free money, waiting for a market
            </p>
            <p className="text-sm leading-[1.5] text-muted text-pretty">
              A market in this group resolved without any winners. Your group holds the bets in this outcome,
              sending that pool to the winners of the next created market. If the season ends first, it splits
              evenly across everyone still playing.
            </p>

            <div className="flex flex-col gap-2 border-t border-rule pt-3">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-[13.5px] text-muted">Held for this group</span>
                <span className="text-sm font-extrabold text-signal tabular-nums">{formatTokens(amount)}</span>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-[13.5px] text-muted">Goes to</span>
                <span className="text-sm font-extrabold text-ink">The next market created</span>
              </div>
            </div>
          </div>

          <div className="border-t border-rule px-[18px] py-[14px]">
            <Button className="w-full" onClick={() => setShowInfo(false)}>
              Got it
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
}
