'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';

export function NewMarketButton({ groupId, bettingEnabled }: { groupId: string; bettingEnabled: boolean }) {
  const [showModal, setShowModal] = useState(false);

  if (!bettingEnabled) {
    return (
      <>
        <Button size="sm" variant="muted" onClick={() => setShowModal(true)}>
          New market
        </Button>
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
    <Link href={`/groups/${groupId}/markets/new`}>
      <Button size="sm">New market</Button>
    </Link>
  );
}
