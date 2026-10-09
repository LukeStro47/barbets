'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { regenerateInviteCode } from '@/lib/actions/groups';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';

/**
 * 4l/4o's invite card: "Invite code" over the code in mono, the owner's "New code" beside an ink
 * "Share" (which opens the full 5m invite screen: QR, code, link), and a wash footer saying
 * whether the group is taking new members.
 */
export function InviteHeroCard({
  groupId,
  inviteCode,
  footer,
  canRegenerate,
}: {
  groupId: string;
  groupName?: string;
  inviteCode: string;
  footer: string;
  canRegenerate: boolean;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  return (
    <div className="overflow-hidden rounded-[18px] border border-hairline bg-surface">
      <div className="flex items-center gap-[11px] px-4 py-3.5">
        <span className="min-w-0 flex-1">
          <span className="block text-[10.5px] font-bold tracking-[0.1em] text-faint uppercase">Invite code</span>
          <span className="mt-1 block font-mono text-[20px] font-semibold tracking-[0.12em] text-ink">{inviteCode}</span>
        </span>
        {canRegenerate && (
          <button
            type="button"
            disabled={isPending}
            onClick={() => setConfirming(true)}
            className="shrink-0 rounded-[10px] border border-hairline bg-surface px-3 py-[9px] text-[12px] font-bold text-muted"
          >
            New code
          </button>
        )}
        <Link href={`/groups/${groupId}/invite`} className="shrink-0 rounded-[11px] bg-ink px-3.5 py-2.5 text-[12.5px] font-bold text-surface">
          Share
        </Link>
      </div>
      {error && <p className="px-4 pb-2 text-[12px] font-semibold text-alert">{error}</p>}
      <p className="border-t border-rule bg-wash px-4 py-[9px] text-[11.5px] text-faint">{footer}</p>

      {confirming && (
        <Modal onClose={() => setConfirming(false)}>
          <p className="font-display text-lg font-extrabold tracking-[-0.015em] text-ink">Get a new invite code?</p>
          <p className="text-sm leading-[1.5] text-muted">The old code stops working. Anyone already in the group stays in.</p>
          <div className="flex gap-2 pt-1">
            <Button type="button" variant="outline" className="flex-1" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              className="flex-1"
              disabled={isPending}
              onClick={() =>
                startTransition(async () => {
                  const result = await regenerateInviteCode(groupId);
                  setConfirming(false);
                  if (result.error) setError(result.error);
                  else router.refresh();
                })
              }
            >
              New code
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
