'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { Mention } from '@/components/ui/Mention';
import { UserAvatar } from '@/components/ui/UserAvatar';
import { RemoveMemberButton } from '@/components/groups/SettingsActions';

export interface RosterEntry {
  membershipId: string;
  userId: string;
  nickname: string;
  isOwner: boolean;
  isDormant: boolean;
  isYou: boolean;
  avatarUpdatedAt?: string | null;
  avatarPresetKey?: string | null;
}

/** A private group's full member list, alphabetized so a specific name is something you jump to
 * rather than scan for. Each row is a profile link; Remove sits outside that link so it doesn't
 * navigate. */
export function MemberRosterList({ groupId, members, canRemove }: { groupId: string; members: RosterEntry[]; canRemove: boolean }) {
  const sorted = useMemo(
    () => [...members].sort((a, b) => a.nickname.localeCompare(b.nickname, undefined, { sensitivity: 'base' })),
    [members]
  );

  return (
    <>
      {sorted.map((m) => (
        <div key={m.userId} className="flex items-center gap-3 px-4 py-3">
          <Link
            href={`/groups/${groupId}/members/${m.membershipId}`}
            className="flex min-w-0 flex-1 items-center gap-2.5"
          >
            <UserAvatar
              userId={m.userId}
              nickname={m.nickname}
              avatarUpdatedAt={m.avatarUpdatedAt}
              avatarPresetKey={m.avatarPresetKey}
              className="h-9 w-9 shrink-0 border-[1.5px] border-espresso-100 text-xs"
              fallbackClassName="bg-espresso-50 text-espresso-700"
            />
            <span className="min-w-0 truncate text-sm text-espresso-800">
              <Mention nickname={m.nickname} className="font-semibold" />
              {m.isOwner && <span className="ml-1.5 text-[11.5px] font-bold text-honey-700">owner</span>}
              {m.isDormant && <span className="ml-1.5 text-[11.5px] text-espresso-400">dormant</span>}
            </span>
          </Link>
          {canRemove && !m.isOwner ? (
            <RemoveMemberButton groupId={groupId} userId={m.userId} nickname={m.nickname} />
          ) : m.isYou ? (
            <span className="shrink-0 text-[12.5px] text-espresso-300">you</span>
          ) : null}
        </div>
      ))}
    </>
  );
}
