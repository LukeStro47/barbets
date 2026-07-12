'use client';

import { useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';

/** Same shape as a StatTile, but a real button — tapping it explains where the extra money came from, since "bonus pool" means nothing on sight. */
export function BonusPoolTile({ amount }: { amount: number }) {
  const [showInfo, setShowInfo] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setShowInfo(true)}
        className="flex shrink-0 flex-col items-center gap-0.5 rounded-xl bg-espresso-50 px-4 py-2 text-center"
      >
        <span className="text-[10px] font-bold uppercase tracking-wide text-espresso-400">Bonus pool</span>
        <span className="font-display text-lg font-bold leading-tight text-espresso-800">{amount}</span>
      </button>
      {showInfo && (
        <Modal onClose={() => setShowInfo(false)}>
          <p className="font-display font-bold text-espresso-900">What's a bonus pool?</p>
          <p className="text-sm text-espresso-600">
            Another market in this group resolved and nobody predicted the outcome. Instead of just refunding
            everyone, the group has payout splitting turned on, so part of that pool got sent here. It'll be added
            to this market's own pool and split among the winners when this one resolves.
          </p>
          <Button className="w-full" onClick={() => setShowInfo(false)}>
            Got it
          </Button>
        </Modal>
      )}
    </>
  );
}
