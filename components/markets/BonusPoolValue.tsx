'use client';

import { useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { formatTokens } from '@/lib/formatNumber';

/**
 * The Bonus cell's figure in an open market's `PoolStrip`, and the explainer it opens.
 *
 * Same tap-to-explain affordance as the Closes cell next to it (a dotted underline on a dark
 * strip, `espresso-300`), because the question it answers is the same shape: the number is the
 * headline, the reason it exists is one tap away rather than a sentence taking up the page.
 * `markets.bonus_pool` is money that came from somewhere other than this market's bettors, so
 * the modal spells out the arithmetic instead of asserting a total.
 */
export function BonusPoolValue({ bonusPool, staked }: { bonusPool: number; staked: number }) {
  const [showDetails, setShowDetails] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setShowDetails(true)}
        className="underline decoration-espresso-300 decoration-dotted underline-offset-[3px]"
      >
        {formatTokens(bonusPool)}
      </button>

      {showDetails && (
        <Modal onClose={() => setShowDetails(false)} padded={false} panelClassName="overflow-hidden">
          <div className="flex items-center justify-between gap-3 bg-espresso-50 px-[18px] py-[13px]">
            <p className="text-xs font-extrabold tracking-[0.06em] text-espresso-800 uppercase">Bonus pool</p>
            <p className="shrink-0 text-xs font-semibold text-espresso-500">{formatTokens(bonusPool)} tokens</p>
          </div>

          <div className="flex flex-col gap-3 p-[18px]">
            <p className="font-display text-[19px] font-extrabold tracking-[-0.01em] text-espresso-900">
              Free money in the pool
            </p>
            <p className="text-sm leading-[1.5] text-espresso-700 text-pretty">
              An earlier market ended with no winners, so its pool was carried into this market.
            </p>

            <div className="flex flex-col gap-2 border-t border-espresso-50 pt-3">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-[13.5px] text-espresso-500">Staked so far</span>
                <span className="text-sm font-extrabold text-espresso-900 tabular-nums">{formatTokens(staked)}</span>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-[13.5px] text-espresso-500">Bonus carried in</span>
                <span className="text-sm font-extrabold text-honey-700 tabular-nums">+{formatTokens(bonusPool)}</span>
              </div>
              <div className="flex items-baseline justify-between gap-3 border-t border-espresso-50 pt-2">
                <span className="text-[13.5px] font-bold text-espresso-900">Pays out</span>
                <span className="text-base font-extrabold text-espresso-950 tabular-nums">{formatTokens(staked + bonusPool)}</span>
              </div>
            </div>

            <p className="text-[12.5px] leading-[1.45] text-espresso-400">
              Winners split it with the rest of the pool. If this market is voided, it moves to the next one.
            </p>
          </div>

          <div className="border-t border-espresso-50 px-[18px] py-[14px]">
            <Button className="w-full" onClick={() => setShowDetails(false)}>
              Got it
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
}
