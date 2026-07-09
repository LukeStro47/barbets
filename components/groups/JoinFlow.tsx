'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { joinGroup } from '@/lib/actions/groups';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { StackedLogo } from '@/components/ui/StackedLogo';
import { Modal } from '@/components/ui/Modal';

const inputClasses =
  'w-full rounded-xl border border-espresso-200 bg-paper-white px-4 py-2.5 text-center text-espresso-900 placeholder:text-espresso-300 focus:border-honey-500 focus:outline-none focus:ring-2 focus:ring-honey-200';

const BLOCKED_COPY: Record<'removed' | 'not_accepting', { title: string; body: string }> = {
  removed: {
    title: "You can't rejoin this group.",
    body: 'The owner removed you from it.',
  },
  not_accepting: {
    title: "This group isn't accepting new members right now.",
    body: 'Check back later, or ask the owner to open it back up.',
  },
};

/**
 * Two steps, same shape as the old claim-username page: confirm you're
 * joining the right group, then a dedicated screen (with room for real
 * directions) to pick your nickname. `blockedReason` lets the confirm step
 * still render normally (so there's always something to look at and a way
 * back) — clicking Join just surfaces a dismissible modal explaining why it
 * won't work, instead of a dead-end page with no way out.
 */
export function JoinFlow({
  inviteCode,
  groupName,
  blockedReason = null,
}: {
  inviteCode: string;
  groupName: string;
  blockedReason?: 'removed' | 'not_accepting' | null;
}) {
  const router = useRouter();
  const [step, setStep] = useState<'confirm' | 'nickname'>('confirm');
  const [showBlockedModal, setShowBlockedModal] = useState(false);
  const [nickname, setNickname] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  if (step === 'confirm') {
    return (
      <div className="w-full max-w-sm space-y-6 text-center">
        <StackedLogo height={100} />
        <Card>
          <p className="text-espresso-600">You've been invited to join</p>
          <p className="font-display text-2xl font-bold text-espresso-900">{groupName}</p>
          <Button
            size="lg"
            className="mt-4 w-full"
            onClick={() => (blockedReason ? setShowBlockedModal(true) : setStep('nickname'))}
          >
            Join {groupName}
          </Button>
        </Card>
        {showBlockedModal && blockedReason && (
          <Modal onClose={() => setShowBlockedModal(false)}>
            <p className="font-display font-bold text-espresso-900">{BLOCKED_COPY[blockedReason].title}</p>
            <p className="text-sm text-espresso-500">{BLOCKED_COPY[blockedReason].body}</p>
            <Button className="w-full" onClick={() => setShowBlockedModal(false)}>
              Got it
            </Button>
          </Modal>
        )}
      </div>
    );
  }

  return (
    <div className="w-full max-w-sm space-y-6 text-center">
      <StackedLogo height={100} />
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight text-espresso-900">Choose your nickname</h1>
        <p className="mt-1 text-espresso-500">
          This is what you'll be @mentioned as in {groupName}. One word, just for this group — letters, numbers,
          and underscores only.
        </p>
      </div>
      <Card className="space-y-3">
        {error && <p className="text-sm text-danger-700">{error}</p>}
        <input
          value={nickname}
          onChange={(e) => setNickname(e.target.value.toLowerCase())}
          placeholder="e.g. dan"
          maxLength={20}
          autoFocus
          className={inputClasses}
        />
        <Button
          size="lg"
          className="w-full"
          disabled={isPending || nickname.trim() === ''}
          onClick={() =>
            startTransition(async () => {
              const result = await joinGroup(inviteCode, nickname.trim());
              if (result.error) {
                setError(result.error);
              } else {
                router.push(`/groups/${result.data!.group_id}`);
              }
            })
          }
        >
          Join {groupName}
        </Button>
        <button type="button" onClick={() => setStep('confirm')} className="text-sm font-medium text-espresso-400 hover:text-espresso-700">
          ← Back
        </button>
      </Card>
    </div>
  );
}
