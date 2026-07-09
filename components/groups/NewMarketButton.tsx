'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { PlusIcon } from '@/components/ui/icons';

const iconButtonClass =
  'flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-espresso-900 text-paper-white shadow-[0_1px_2px_rgba(44,31,23,0.15),0_4px_10px_rgba(44,31,23,0.1)] transition-colors hover:bg-espresso-950 active:scale-[0.92]';

export function NewMarketButton({ groupId, bettingEnabled }: { groupId: string; bettingEnabled: boolean }) {
  const [showModal, setShowModal] = useState(false);

  if (!bettingEnabled) {
    return (
      <>
        <button type="button" aria-label="New market" onClick={() => setShowModal(true)} className={iconButtonClass}>
          <PlusIcon className="h-4 w-4" />
        </button>
        {showModal && (
          <Modal onClose={() => setShowModal(false)}>
            <p className="font-display font-bold text-espresso-900">Betting is turned off</p>
            <p className="text-sm text-espresso-500">
              The group owner hasn't turned betting on yet. Once they do, everyone can start creating markets.
            </p>
            <Button className="w-full" onClick={() => setShowModal(false)}>
              Got it
            </Button>
          </Modal>
        )}
      </>
    );
  }

  return (
    <Link href={`/groups/${groupId}/markets/new`} aria-label="New market" className={iconButtonClass}>
      <PlusIcon className="h-4 w-4" />
    </Link>
  );
}
