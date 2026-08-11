'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { voidMarket, voidMarketAsCreator } from '@/lib/actions/resolution';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { ConsequenceRow } from '@/components/ui/ConsequenceRow';
import type { ActionResult } from '@/lib/errors';

interface Props {
  groupId: string;
  marketId: string;
  isOwner: boolean;
  /** True when the group owner is themself a subject of this market, so void_market_by_owner is unreachable for them — the market's creator gets the fallback control instead. */
  isCreator: boolean;
  ownerIsSubject: boolean;
}

/** The "···" nav-row trigger for actions that should be available, not resident — currently
 * just owner void (owner_by_owner, or the creator fallback when the owner is hidden as a
 * subject). Rendered instead of MarketActions' always-visible owner-controls card on the
 * closed/betting-closed and voting screens, where a stray danger-toned card competed with
 * the page's one real job. */
export function MarketOverflowMenu({ groupId, marketId, isOwner, isCreator, ownerIsSubject }: Props) {
  const [open, setOpen] = useState(false);
  const canVoid = isOwner || (isCreator && ownerIsSubject);
  if (!canVoid) return null;

  return (
    <>
      {/* Three drawn dots rather than a "···" text glyph. As text it sat high in its circle and
          needed a padding nudge to fake centring, which only held for one font at one size —
          the glyph's own vertical position inside its em box is the font's decision, not ours.
          An SVG has no baseline to fight. */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Market options"
        className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full bg-espresso-50 text-espresso-500 transition-colors hover:bg-espresso-100"
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor" aria-hidden="true">
          <circle cx="2" cy="7" r="1.5" />
          <circle cx="7" cy="7" r="1.5" />
          <circle cx="12" cy="7" r="1.5" />
        </svg>
      </button>
      {open && (
        <Modal onClose={() => setOpen(false)} padded={false} panelClassName="overflow-hidden">
          <VoidAction
            groupId={groupId}
            marketId={marketId}
            isOwner={isOwner}
            ownerIsSubject={ownerIsSubject}
            onDone={() => setOpen(false)}
          />
        </Modal>
      )}
    </>
  );
}

function VoidAction({
  groupId,
  marketId,
  isOwner,
  ownerIsSubject,
  onDone,
}: {
  groupId: string;
  marketId: string;
  isOwner: boolean;
  ownerIsSubject: boolean;
  onDone: () => void;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // isOwner takes priority — void_market_by_owner is the normal path; the creator-fallback
  // only ever applies when the owner is themself hidden as this market's subject.
  const asCreatorFallback = !isOwner && ownerIsSubject;

  function run(fn: () => Promise<ActionResult<unknown>>) {
    setError(null);
    startTransition(async () => {
      const result = await fn();
      if (result.error) {
        setError(result.error);
      } else {
        onDone();
        router.refresh();
      }
    });
  }

  return (
    <>
      <div className="flex items-center justify-between gap-3 bg-espresso-50 px-[18px] py-[13px]">
        <p className="text-xs font-extrabold tracking-[0.06em] text-espresso-800 uppercase">
          {asCreatorFallback ? "Void in the owner's place" : 'Owner controls'}
        </p>
        <p className="shrink-0 text-xs font-semibold text-espresso-500">Step {confirming ? 2 : 1} of 2</p>
      </div>

      <div className="flex flex-col gap-3.5 p-[18px]">
        <div>
          <p className="font-display text-[19px] font-extrabold tracking-[-0.01em] text-espresso-900">
            {confirming ? 'Void it for good?' : 'Void this market'}
          </p>
          <p className="mt-1 text-[13.5px] leading-[1.45] text-espresso-500">
            {asCreatorFallback
              ? "The group owner is @mentioned in this market, so it's hidden from them and they can't void it themselves. As the market's creator, you can void it in their place."
              : 'Cancels the market outright. Nobody wins and nobody loses.'}
          </p>
        </div>

        {error && <p className="text-sm text-danger-700">{error}</p>}

        <div>
          <p className="mb-2 text-[11.5px] font-extrabold tracking-[0.08em] text-espresso-400 uppercase">What this does</p>
          <div className="flex flex-col">
            <ConsequenceRow dotClassName="bg-danger-500">
              Every bet on this market is <strong className="font-bold text-danger-700">refunded in full</strong>, right now.
            </ConsequenceRow>
            <ConsequenceRow dotClassName="bg-espresso-800">
              The market closes for good. <strong className="font-bold text-espresso-900">This can't be undone.</strong>
            </ConsequenceRow>
            <ConsequenceRow dotClassName="bg-espresso-200" isLast>
              Everyone in the group gets notified that it was voided.
            </ConsequenceRow>
          </div>
        </div>
      </div>

      <div className="flex gap-2 border-t border-espresso-50 px-[18px] py-[14px]">
        <Button type="button" variant="outline" className="flex-1" disabled={isPending} onClick={() => (confirming ? setConfirming(false) : onDone())}>
          {confirming ? 'Back' : 'Close'}
        </Button>
        {!confirming ? (
          <Button type="button" variant="danger" className="flex-1" onClick={() => setConfirming(true)}>
            Void this market
          </Button>
        ) : (
          <Button
            type="button"
            variant="danger"
            className="flex-1"
            disabled={isPending}
            onClick={() => run(() => (asCreatorFallback ? voidMarketAsCreator(groupId, marketId) : voidMarket(groupId, marketId)))}
          >
            Yes, void it
          </Button>
        )}
      </div>
    </>
  );
}
