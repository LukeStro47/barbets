'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { joinGroup } from '@/lib/actions/groups';
import { Button } from '@/components/ui/Button';
import { GroupAvatar } from '@/components/ui/GroupAvatar';
import { Modal } from '@/components/ui/Modal';
import { JUST_JOINED_GROUP_KEY } from '@/components/pwa/PushReminderModal';
import { CaretLeftIcon } from '@/components/ui/icons';

const NICKNAME_MAX_LENGTH = 20;

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
 *
 * The confirm step carries no Barbets mark: the group is the subject of this screen, and a
 * visitor arriving on a friend's link is being introduced to the group, not to the product.
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
      <div className="flex flex-1 flex-col items-center justify-center px-7 py-11 pt-[calc(env(safe-area-inset-top)+2.75rem)] text-center">
        <span className="text-xs font-bold tracking-[2px] text-honey-700 uppercase">You're invited</span>

        <div className="mt-5 w-full rounded-[24px] border border-espresso-100 bg-paper-white px-5 pt-8 pb-[34px]">
          {/* Always the initials monogram in practice: get_group_by_invite_code deliberately
              reveals only id/name/accepting_members/my_status to a non-member, so the group's
              chosen avatar isn't available here. GroupAvatar still owns the fallback. */}
          <GroupAvatar
            name={groupName}
            radiusClassName="rounded-[20px]"
            fallbackClassName="bg-espresso-50 text-[26px] text-honey-700"
            className="mx-auto h-16 w-16"
          />
          {/* balance, not pretty: a long group name has to wrap evenly across two lines here
              rather than leave one orphaned word under a full first line. */}
          <p className="mt-5 font-display text-[26px]/[34px] font-extrabold tracking-[-0.02em] text-balance text-espresso-900">
            {groupName}
          </p>
        </div>

        <div className="mt-7 flex w-full flex-col gap-3">
          <Button
            variant="accent"
            size="xl"
            className="w-full truncate"
            onClick={() => (blockedReason ? setShowBlockedModal(true) : setStep('nickname'))}
          >
            Join {groupName}
          </Button>
          <Link href="/groups" className="text-sm text-espresso-500 hover:text-espresso-800">
            Not your group? Go to your groups →
          </Link>
        </div>

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
    <div className="flex flex-1 flex-col px-7 pb-8 pt-[calc(env(safe-area-inset-top)+3.25rem)]">
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => setStep('confirm')}
          className="-ml-1 inline-flex items-center gap-0.5 text-sm font-semibold text-espresso-500 hover:text-espresso-800"
        >
          <CaretLeftIcon className="h-4 w-4" />
          Back
        </button>
        <span className="text-xs font-bold tracking-[1.6px] text-espresso-500 uppercase">Step 2 of 2</span>
      </div>

      <h1 className="mt-11 font-display text-[34px]/[38px] font-extrabold tracking-[-0.03em] text-espresso-900">
        Pick your name.
      </h1>
      <p className="mt-2.5 text-base/6 text-espresso-500">
        This is what {groupName} will @mention you as. One word, letters, numbers and underscores.
      </p>

      {error && <p className="mt-6 text-sm text-danger-700">{error}</p>}

      {/* The nickname is the whole point of this screen, so it's set at display size rather than
          in a boxed input the eye skims past. The "@" is a static prefix, not part of the value. */}
      <div className="mt-10 flex items-baseline gap-1 border-b-2 border-honey-500 pb-3">
        <span className="font-display text-[32px] font-extrabold text-espresso-400">@</span>
        <input
          value={nickname}
          onChange={(e) => setNickname(e.target.value.toLowerCase())}
          maxLength={NICKNAME_MAX_LENGTH}
          autoFocus
          aria-label="Nickname"
          className="w-full min-w-0 bg-transparent font-display text-[32px] font-extrabold text-espresso-900 caret-honey-500 focus:outline-none"
        />
      </div>
      <span className="mt-3 text-[13px] text-espresso-500">
        {nickname.length} / {NICKNAME_MAX_LENGTH}
      </span>

      <Button
        variant="accent"
        size="xl"
        className="mt-9 w-full truncate"
        disabled={isPending || nickname.trim() === ''}
        onClick={() =>
          startTransition(async () => {
            const result = await joinGroup(inviteCode, nickname.trim());
            if (result.error) {
              setError(result.error);
            } else {
              localStorage.setItem(JUST_JOINED_GROUP_KEY, '1');
              router.push(`/groups/${result.data!.group_id}`);
            }
          })
        }
      >
        Join {groupName}
      </Button>
    </div>
  );
}
