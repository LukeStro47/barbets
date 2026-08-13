'use client';

import { useRouter } from 'next/navigation';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';

/**
 * The dead end of /join/[code]: either the code matches nothing, or the visitor has tried too
 * many codes that matched nothing (the invite-code rate limit). Same shape both times, since
 * both leave the visitor with nowhere to go but back to their groups — only the copy differs,
 * and the rate-limit message comes from Postgres so it can name the actual wait.
 */
export function InvalidInviteModal({
  title = "That invite code doesn't look right.",
  body = 'Double check the link, or ask for a fresh one.',
}: {
  title?: string;
  body?: string;
}) {
  const router = useRouter();
  const dismiss = () => router.push('/groups');

  return (
    <Modal onClose={dismiss}>
      <p className="font-display font-bold text-espresso-900">{title}</p>
      <p className="text-sm text-espresso-500">{body}</p>
      <Button className="w-full" onClick={dismiss}>
        Got it
      </Button>
    </Modal>
  );
}
