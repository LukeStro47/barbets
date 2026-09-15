'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Capacitor } from '@capacitor/core';
import { Share } from '@capacitor/share';
import { regenerateInviteCode } from '@/lib/actions/groups';
import { inviteUrl } from '@/lib/inviteLink';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { LinkIcon, RefreshIcon } from '@/components/ui/icons';
import { InviteQrIconButton } from '@/components/groups/InviteQrButton';

const ghostBtn =
  'flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-full border border-paper-white/30 text-paper-white transition-colors hover:bg-white/10';

async function shareInviteLink(groupName: string, inviteCode: string): Promise<'shared' | 'copied'> {
  const url = inviteUrl(inviteCode, 'link');
  const title = `Join ${groupName}`;
  const text = `Join ${groupName} on Barbets. Invite code ${inviteCode}`;

  if (Capacitor.isNativePlatform()) {
    try {
      await Share.share({ title, text, url });
      return 'shared';
    } catch (err) {
      if (isDismissal(err)) return 'shared';
    }
  }

  if (typeof navigator.share === 'function') {
    try {
      await navigator.share({ title, text, url });
      return 'shared';
    } catch (err) {
      if ((err as { name?: string }).name === 'AbortError') return 'shared';
    }
  }

  await navigator.clipboard.writeText(url);
  return 'copied';
}

function isDismissal(err: unknown): boolean {
  const e = err as { name?: string; message?: string } | null;
  if (e?.name === 'AbortError') return true;
  const message = String(e?.message ?? '').toLowerCase();
  return message.includes('cancel') || message.includes('abort') || message.includes('dismiss');
}

export function InviteHeroCard({
  groupId,
  groupName,
  inviteCode,
  footer,
  canRegenerate,
}: {
  groupId: string;
  groupName: string;
  inviteCode: string;
  footer: string;
  canRegenerate: boolean;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  async function share() {
    try {
      const result = await shareInviteLink(groupName, inviteCode);
      if (result === 'copied') {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    } catch {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  return (
    <div className="rounded-[20px] bg-gradient-to-br from-espresso-900 to-espresso-700 px-5 py-[18px]">
      <p className="text-[10.5px] font-bold tracking-[0.12em] text-honey-400 uppercase">Invite code</p>
      <p className="mt-1 font-display text-[34px] leading-none font-extrabold tracking-[0.08em] text-paper-white">{inviteCode}</p>

      {error && <p className="mt-2 text-xs text-honey-300">{error}</p>}

      <div className="mt-3.5 flex gap-2">
        <button
          type="button"
          onClick={() => void share()}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-full bg-honey-500 px-3 py-[9px] text-[12.5px] font-extrabold text-espresso-900 transition-colors hover:bg-[#d4912f]"
        >
          <LinkIcon className="h-[15px] w-[15px]" />
          {copied ? 'Copied' : 'Share link'}
        </button>
        <InviteQrIconButton inviteCode={inviteCode} groupName={groupName} className={ghostBtn} />
        {canRegenerate && (
          <button type="button" className={ghostBtn} disabled={isPending} onClick={() => setConfirming(true)} aria-label="Regenerate invite code">
            <RefreshIcon className="h-[17px] w-[17px]" />
          </button>
        )}
      </div>

      <p className="mt-3 text-[11.5px] text-paper-white/55">{footer}</p>

      {confirming && (
        <Modal onClose={() => setConfirming(false)}>
          <p className="font-display text-lg font-extrabold tracking-[-0.015em] text-espresso-950">Regenerate the invite code?</p>
          <p className="text-sm leading-[1.5] text-espresso-600">
            The old code stops working. Anyone already in the group stays in.
          </p>
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
                  if (result.error) {
                    setError(result.error);
                    setConfirming(false);
                  } else {
                    setConfirming(false);
                    router.refresh();
                  }
                })
              }
            >
              Regenerate
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
