'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { leaveGroup } from '@/lib/actions/groups';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { ConsequenceRow } from '@/components/ui/ConsequenceRow';
import { NavRowContent, settingsNavRowClasses } from '@/components/ui/SettingsList';

/** A row inside the member's "You in this group" card, opening its own sheet — the consequences of
 *  leaving take a whole screen rather than an inline panel that pushes the rest of the list down. */
export function LeaveGroupButton({ groupId, groupName }: { groupId: string; groupName: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  return (
    <>
      <button type="button" className={settingsNavRowClasses} onClick={() => setConfirming(true)}>
        <NavRowContent
          label="Leave this group"
          consequence="Markets about you are voided; your other bets settle without you."
          danger
        />
      </button>

      {confirming && (
        <Modal onClose={() => setConfirming(false)}>
          <p className="font-display text-lg font-extrabold tracking-[-0.015em] text-espresso-950">Leave {groupName}?</p>
          {error && <p className="text-sm text-danger-700">{error}</p>}
          <div className="pt-0.5">
            <ConsequenceRow dotClassName="bg-danger-500">Any market about you is voided and refunded.</ConsequenceRow>
            <ConsequenceRow dotClassName="bg-espresso-800">
              Your other open bets stay in play and settle without you.
            </ConsequenceRow>
            <ConsequenceRow dotClassName="bg-espresso-200" isLast>
              If you come back later, you aren&apos;t reseeded.
            </ConsequenceRow>
          </div>
          <div className="flex gap-2 pt-1">
            <Button type="button" variant="outline" className="flex-1" onClick={() => setConfirming(false)}>
              Stay
            </Button>
            <Button
              type="button"
              variant="danger"
              className="flex-1"
              disabled={isPending}
              onClick={() =>
                startTransition(async () => {
                  const result = await leaveGroup(groupId);
                  if (result.error) {
                    setError(result.error);
                  } else {
                    router.push('/groups?all=1');
                  }
                })
              }
            >
              Leave
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
}
