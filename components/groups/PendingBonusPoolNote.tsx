'use client';

import { useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { formatTokens } from '@/lib/formatNumber';

/** groups.pending_bonus_pool: money from a universal-loss market that hasn't found a next market to
    seed yet (none were open at the time), holding at the group level instead of a specific market's
    bonus_pool. Surfaced here since it's otherwise invisible until it lands on a market — same
    tap-to-explain treatment as BonusPoolTile. */
export function PendingBonusPoolNote({ amount }: { amount: number }) {
  const [showInfo, setShowInfo] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setShowInfo(true)}
        className="flex w-full items-center gap-2.5 rounded-2xl border border-honey-300/60 bg-honey-50 px-4 py-3 text-left"
      >
        <span className="text-lg leading-none">🎁</span>
        <span className="min-w-0 flex-1 text-sm font-semibold text-espresso-700">
          {formatTokens(amount)} tokens waiting for the next market
        </span>
        <span className="shrink-0 text-xs font-bold text-espresso-400 underline decoration-dotted underline-offset-2">Why?</span>
      </button>
      {showInfo && (
        <Modal onClose={() => setShowInfo(false)}>
          <p className="font-display font-bold text-espresso-900">What's this bonus pool?</p>
          <p className="text-sm text-espresso-600">
            A market in this group resolved without any winners. Your group has payout splitting turned on, so part
            of that pool is held here instead of going to another market right away. It'll seed the next market
            created in this group and split among the winners when that one resolves.
          </p>
          <Button className="w-full" onClick={() => setShowInfo(false)}>
            Got it
          </Button>
        </Modal>
      )}
    </>
  );
}
