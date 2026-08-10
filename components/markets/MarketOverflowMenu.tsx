'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { voidMarket, voidMarketAsCreator } from '@/lib/actions/resolution';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
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
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Market options"
        className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full bg-espresso-50 pb-1.5 text-base font-extrabold tracking-[0.06em] text-espresso-500"
      >
        ···
      </button>
      {open && (
        <Modal onClose={() => setOpen(false)}>
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
    <div className="space-y-3">
      <p className="font-display font-bold text-espresso-900">{asCreatorFallback ? "Owner can't act on this one" : 'Owner controls'}</p>
      {error && <p className="text-sm text-danger-700">{error}</p>}
      {asCreatorFallback && (
        <p className="text-sm text-espresso-500">
          The group owner is @mentioned in this market, so it's hidden from them and they can't void it themselves.
          As the market's creator, you can void it in their place.
        </p>
      )}
      {!confirming ? (
        <>
          <p className="text-sm text-espresso-500">Cancel this market and refund every stake. This can't be undone.</p>
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={onDone}>
              Close
            </Button>
            <Button variant="danger" className="flex-1" onClick={() => setConfirming(true)}>
              Void this market
            </Button>
          </div>
        </>
      ) : (
        <>
          <p className="text-sm font-semibold text-danger-700">
            Every bet on this market gets refunded in full and it closes for good. Everyone gets notified.
          </p>
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              className="flex-1"
              disabled={isPending}
              onClick={() => run(() => (asCreatorFallback ? voidMarketAsCreator(groupId, marketId) : voidMarket(groupId, marketId)))}
            >
              Confirm
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
