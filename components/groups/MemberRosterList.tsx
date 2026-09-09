'use client';

import { useMemo, useState } from 'react';
import { Mention } from '@/components/ui/Mention';
import { RemoveMemberButton } from '@/components/groups/SettingsActions';

export interface RosterEntry {
  userId: string;
  nickname: string;
  isOwner: boolean;
  isDormant: boolean;
  isYou: boolean;
  /** Consecutive local days this member has opened the app (the 7-day login reward streak).
      Shown to fellow members on purpose: it's a count of app opens, nothing money- or
      market-shaped, and seeing a friend on day 5 is the social point of a streak. */
  streak?: number;
}

const DEFAULT_VISIBLE = 4;

/** A private group's member list, collapsed to a handful of names with a "Show all" toggle
 * rather than every member rendered unconditionally — the settings page otherwise got long fast
 * once a group passed a dozen or so members. Alphabetized (the previous version was whatever
 * order the query happened to return, which was effectively insertion order and made a specific
 * name something you had to scan for rather than jump to). */
export function MemberRosterList({ groupId, members, canRemove }: { groupId: string; members: RosterEntry[]; canRemove: boolean }) {
  const [expanded, setExpanded] = useState(false);

  const sorted = useMemo(
    () => [...members].sort((a, b) => a.nickname.localeCompare(b.nickname, undefined, { sensitivity: 'base' })),
    [members]
  );
  const shown = expanded ? sorted : sorted.slice(0, DEFAULT_VISIBLE);
  const hiddenCount = sorted.length - shown.length;

  return (
    <>
      {shown.map((m) => (
        <div key={m.userId} className="flex items-center justify-between gap-3 px-4 py-3">
          <span className="min-w-0 truncate text-sm text-espresso-800">
            <Mention nickname={m.nickname} className="font-semibold" />
            {m.isOwner && <span className="ml-1.5 text-[11.5px] font-bold text-honey-700">owner</span>}
            {m.isDormant && <span className="ml-1.5 text-[11.5px] text-espresso-400">dormant</span>}
            {(m.streak ?? 0) > 0 && <span className="ml-1.5 text-[11.5px] text-espresso-400">{m.streak}-day streak</span>}
          </span>
          {canRemove && !m.isOwner ? (
            <RemoveMemberButton groupId={groupId} userId={m.userId} nickname={m.nickname} />
          ) : m.isYou ? (
            <span className="shrink-0 text-[12.5px] text-espresso-300">you</span>
          ) : null}
        </div>
      ))}
      {hiddenCount > 0 && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="w-full px-4 py-3 text-left text-[13px] font-bold text-honey-700 hover:text-honey-800"
        >
          Show all {sorted.length} →
        </button>
      )}
    </>
  );
}
