'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Mention } from '@/components/ui/Mention';

/**
 * Opens a simple pick-one list rather than the create-market flow's chip-strip subject picker —
 * that component is built for multi-select-with-a-cap against a whole group; this just needs one
 * name tapped out of a short list, closer to TransferOwnershipSheet's member picker than to it.
 */
export function CompareMemberPicker({
  groupId,
  membershipId,
  others,
}: {
  groupId: string;
  membershipId: string;
  others: { id: string; nickname: string }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  if (others.length === 0) return null;

  return (
    <>
      <Button type="button" variant="outline" className="w-full" onClick={() => setOpen(true)}>
        Compare with someone
      </Button>

      {open && (
        <Modal onClose={() => setOpen(false)}>
          <p className="font-display text-lg font-extrabold tracking-[-0.015em] text-espresso-950">Compare with</p>
          <div className="max-h-[50vh] space-y-1 overflow-y-auto">
            {others.map((m) => (
              <button
                key={m.id}
                type="button"
                className="flex w-full items-center rounded-xl px-3 py-2.5 text-left hover:bg-espresso-50"
                onClick={() => router.push(`/groups/${groupId}/members/${membershipId}/vs/${m.id}`)}
              >
                <Mention nickname={m.nickname} className="font-semibold text-espresso-900" />
              </button>
            ))}
          </div>
        </Modal>
      )}
    </>
  );
}
