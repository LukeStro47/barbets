'use client';

import { useRouter } from 'next/navigation';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';

export function InvalidInviteModal() {
  const router = useRouter();
  const dismiss = () => router.push('/groups');

  return (
    <Modal onClose={dismiss}>
      <p className="font-display font-bold text-espresso-900">That invite code doesn't look right.</p>
      <p className="text-sm text-espresso-500">Double check the link, or ask for a fresh one.</p>
      <Button className="w-full" onClick={dismiss}>
        Got it
      </Button>
    </Modal>
  );
}
