'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { cancelGroupDeletion } from '@/lib/actions/groups';
import { Button } from '@/components/ui/Button';
import { AlertTriangleIcon } from '@/components/ui/icons';

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
    // danger-100/danger-500/danger-700 are the steps that actually exist in globals.css. This used
    // to reach for danger-50/200/600, none of which are defined, so the banner rendered with no
    // fill, no border and default body colour — an urgent message that looked like a caption.
    <div className="flex gap-3 rounded-[14px] border-[1.5px] border-danger-500 bg-danger-100 px-4 py-3.5">
      <AlertTriangleIcon className="mt-px h-5 w-5 shrink-0 text-danger-700" />
      <div className="space-y-2">
        <div>
          <p className="text-sm font-bold text-danger-700">
            Deleted in {days} day{days === 1 ? '' : 's'}
          </p>
          <p className="mt-[3px] text-[12.5px] leading-[1.5] text-danger-700">
            Every open market was voided and refunded already. Everything stays viewable until then.
          </p>
        </div>
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
    </div>
  );
}
