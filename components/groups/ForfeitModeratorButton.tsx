'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { forfeitModerator } from '@/lib/actions/discover';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { NavRowContent, settingsNavRowClasses } from '@/components/ui/SettingsList';

/** A lighter option than leaving entirely: step back from moderating a public group while staying
    a regular member. Own row in "You in this group", same shell LeaveGroupButton uses. */
export function ForfeitModeratorButton({ groupId, groupName }: { groupId: string; groupName: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  return (
    <>
      <button type="button" className={settingsNavRowClasses} onClick={() => setConfirming(true)}>
        <NavRowContent label="Forfeit moderator" consequence="You stay in the group as a regular member." />
      </button>

      {confirming && (
        <Modal onClose={() => setConfirming(false)}>
          <p className="font-display text-lg font-extrabold tracking-[-0.015em] text-espresso-950">Stop moderating {groupName}?</p>
          {error && <p className="text-sm text-danger-700">{error}</p>}
          <p className="text-sm leading-[1.55] text-espresso-600">
            You lose the ability to create markets by hand or remove members. You can be reassigned later.
          </p>
          <div className="flex gap-2 pt-1">
            <Button type="button" variant="outline" className="flex-1" onClick={() => setConfirming(false)}>
              Stay a moderator
            </Button>
            <Button
              type="button"
              variant="danger"
              className="flex-1"
              disabled={isPending}
              onClick={() =>
                startTransition(async () => {
                  const result = await forfeitModerator(groupId);
                  if (result.error) {
                    setError(result.error);
                  } else {
                    router.push(`/groups/${groupId}`);
                  }
                })
              }
            >
              Forfeit
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
}
