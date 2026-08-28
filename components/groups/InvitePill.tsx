'use client';

import { useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { LinkIcon } from '@/components/ui/icons';

/** The balance card's compact "Invite" pill — the code itself moved out of the card's
 * permanent real estate (it's a once-a-month action, not something that deserves a fixed
 * line every time someone opens the group) and into a small modal one tap away instead. */
export function InvitePill({ inviteCode }: { inviteCode: string }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

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
          {/* No link, just the code: MobileAppGate blocks a phone browser from almost every
              route (including /join/[code]) unless the app is already installed, so a shared
              link mostly just lands a friend on the "get the app" wall instead of the group.
              The code is what actually works either way — typed into "Got an invite code?"
              once they have the app. Boxed per character to match that entry screen's own
              InviteCodeBoxes, not just for looks. */}
          <div className="flex justify-center gap-2 py-1">
            {inviteCode.split('').map((char, i) => (
              <span
                key={i}
                className="flex h-[54px] w-[46px] items-center justify-center rounded-2xl border-[1.5px] border-espresso-200 bg-paper font-display text-2xl font-extrabold text-espresso-900"
              >
                {char}
              </span>
            ))}
          </div>
          <div className="flex gap-2 pt-1">
            <Button variant="outline" className="flex-1" onClick={() => setOpen(false)}>
              Close
            </Button>
            <Button
              className="flex-1"
              onClick={async () => {
                await navigator.clipboard.writeText(inviteCode);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}
            >
              {copied ? 'Copied' : 'Copy code'}
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
}
