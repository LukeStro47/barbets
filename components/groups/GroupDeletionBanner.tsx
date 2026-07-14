'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { cancelGroupDeletion } from '@/lib/actions/groups';
import { Button } from '@/components/ui/Button';

function daysLeft(iso: string): number {
  return Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000));
}

/** Shown group-wide once the owner has scheduled deletion — everyone gets a full 5 days to see final market states before the group actually disappears. Only the owner can undo it. */
export function GroupDeletionBanner({
  groupId,
  deletionScheduledAt,
  isOwner,
}: {
  groupId: string;
  deletionScheduledAt: string;
  isOwner: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const days = daysLeft(deletionScheduledAt);

  return (
    <div className="space-y-2 rounded-2xl border border-danger-200 bg-danger-50 px-4 py-3.5">
      <p className="text-sm font-semibold text-danger-700">
        This group will be permanently deleted in {days} day{days === 1 ? '' : 's'}.
      </p>
      <p className="text-xs text-danger-600">
        Every open market was voided and refunded already. Everything stays viewable until then.
      </p>
      {error && <p className="text-xs font-semibold text-danger-700">{error}</p>}
      {isOwner && (
        <Button
          variant="outline"
          size="sm"
          disabled={isPending}
          onClick={() =>
            startTransition(async () => {
              const result = await cancelGroupDeletion(groupId);
              if (result.error) {
                setError(result.error);
              } else {
                router.refresh();
              }
            })
          }
        >
          Cancel deletion
        </Button>
      )}
    </div>
  );
}
