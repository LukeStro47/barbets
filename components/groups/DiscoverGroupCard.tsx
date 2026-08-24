'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { joinPublicGroup } from '@/lib/actions/discover';
import { GroupAvatar } from '@/components/ui/GroupAvatar';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { JUST_JOINED_GROUP_KEY } from '@/components/pwa/PushReminderModal';
import { numberWord } from '@/lib/formatNumber';

const NICKNAME_MAX_LENGTH = 20;

/** One directory row plus its own instant-join flow — a single nickname prompt, no invite-code
    confirm step, since browsing here already is the confirmation. Already a member? The row
    links straight to the group instead of offering to join it again. */
export function DiscoverGroupCard({
  groupId,
  name,
  avatarKey,
  memberCount,
  joined = false,
}: {
  groupId: string;
  name: string;
  avatarKey: string | null;
  memberCount: number;
  joined?: boolean;
}) {
  const router = useRouter();
  const [joining, setJoining] = useState(false);
  const [nickname, setNickname] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  return (
    <>
      <div className="flex items-center gap-3 rounded-[18px] border border-espresso-100 bg-paper-white p-3.5">
        <GroupAvatar
          name={name}
          avatarKey={avatarKey}
          className="h-11 w-11 text-[13px]"
          fallbackClassName="bg-espresso-50 text-espresso-500"
        />
        <span className="min-w-0 flex-1">
          <p className="truncate font-display text-[15px] font-extrabold tracking-[-0.01em] text-espresso-950">{name}</p>
          <p className="mt-[3px] text-[12px] text-espresso-500">
            {memberCount === 0 ? 'Be the first to join' : `${numberWord(memberCount)} playing`}
          </p>
        </span>
        {joined ? (
          <Link
            href={`/groups/${groupId}`}
            className="shrink-0 rounded-full border border-espresso-200 px-3 py-1.5 text-sm font-semibold text-espresso-600"
          >
            Joined
          </Link>
        ) : (
          <Button variant="accent" size="sm" onClick={() => setJoining(true)} className="shrink-0">
            Join
          </Button>
        )}
      </div>

      {joining && (
        <Modal onClose={() => setJoining(false)}>
          <p className="font-display text-lg font-extrabold tracking-[-0.015em] text-espresso-950">Join {name}</p>
          {error && <p className="text-sm text-danger-700">{error}</p>}

          <div className="flex items-baseline gap-1 border-b-2 border-honey-500 pb-2">
            <span className="font-display text-xl font-extrabold text-espresso-400">@</span>
            <input
              value={nickname}
              onChange={(e) => setNickname(e.target.value.toLowerCase())}
              maxLength={NICKNAME_MAX_LENGTH}
              autoFocus
              aria-label="Nickname"
              className="w-full min-w-0 bg-transparent font-display text-xl font-extrabold text-espresso-900 caret-honey-500 focus:outline-none"
            />
          </div>
          <p className="text-xs text-espresso-500">One word, letters, numbers and underscores.</p>

          <div className="flex gap-2 pt-1">
            <Button type="button" variant="outline" className="flex-1" onClick={() => setJoining(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              className="flex-1"
              disabled={isPending || nickname.trim() === ''}
              onClick={() =>
                startTransition(async () => {
                  const result = await joinPublicGroup(groupId, nickname.trim());
                  if (result.error) {
                    setError(result.error);
                    return;
                  }
                  localStorage.setItem(JUST_JOINED_GROUP_KEY, '1');
                  router.push(`/groups/${groupId}`);
                })
              }
            >
              Join
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
}
