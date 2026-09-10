'use client';

import { useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { LinkIcon } from '@/components/ui/icons';
import { inviteUrl } from '@/lib/inviteLink';

/** The balance card's compact "Invite" pill — the code itself moved out of the card's
 * permanent real estate (it's a once-a-month action, not something that deserves a fixed
 * line every time someone opens the group) and into a small modal one tap away instead. */
export function InvitePill({ inviteCode }: { inviteCode: string }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState<'link' | 'code' | null>(null);

  function copy(kind: 'link' | 'code', value: string) {
    navigator.clipboard.writeText(value).then(() => {
      setCopied(kind);
      setTimeout(() => setCopied(null), 2000);
    });
  }

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
          {/* Boxed per character to match the join entry screen's own InviteCodeBoxes, not
              just for looks. The code is what still works if the app asks for it directly;
              the link below is what actually gets a friend into the group now that there's
              no mobile-browser gate blocking /join/[code]. */}
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
          <Button className="w-full" onClick={() => copy('link', inviteUrl(inviteCode, 'link'))}>
            {copied === 'link' ? 'Copied' : 'Copy invite link'}
          </Button>
          <div className="flex gap-2 pt-1">
            <Button variant="outline" className="flex-1" onClick={() => setOpen(false)}>
              Close
            </Button>
            <Button variant="outline" className="flex-1" onClick={() => copy('code', inviteCode)}>
              {copied === 'code' ? 'Copied' : 'Copy code'}
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
}
