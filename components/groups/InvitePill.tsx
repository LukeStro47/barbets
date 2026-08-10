'use client';

import { useEffect, useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { LinkIcon } from '@/components/ui/icons';

/** The balance card's compact "Invite" pill — the code itself moved out of the card's
 * permanent real estate (it's a once-a-month action, not something that deserves a fixed
 * line every time someone opens the group) and into a small modal one tap away instead. */
export function InvitePill({ inviteCode }: { inviteCode: string }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [url, setUrl] = useState(`/join/${inviteCode}`);

  useEffect(() => {
    setUrl(`${window.location.origin}/join/${inviteCode}`);
  }, [inviteCode]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-white/[0.09] px-[11px] py-[5px] text-xs font-bold text-honey-200"
      >
        <LinkIcon className="h-3 w-3" />
        Invite
      </button>
      {open && (
        <Modal onClose={() => setOpen(false)}>
          <p className="font-display font-bold text-espresso-900">Invite code</p>
          <p className="font-display text-2xl font-extrabold tracking-[0.08em] text-espresso-900">{inviteCode}</p>
          <p className="truncate text-sm text-espresso-500">{url}</p>
          <div className="flex gap-2 pt-1">
            <Button variant="outline" className="flex-1" onClick={() => setOpen(false)}>
              Close
            </Button>
            <Button
              className="flex-1"
              onClick={async () => {
                await navigator.clipboard.writeText(url);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}
            >
              {copied ? 'Copied' : 'Copy link'}
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
}
