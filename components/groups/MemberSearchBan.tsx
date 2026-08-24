'use client';

import { useMemo, useState } from 'react';
import { Mention } from '@/components/ui/Mention';
import { RemoveMemberButton } from '@/components/groups/SettingsActions';

interface Member {
  userId: string;
  nickname: string;
  isOwner: boolean;
  isModerator: boolean;
}

/** A public group's roster can run into the hundreds, so listing everyone the way a private
    group's settings page does doesn't scale — and there's rarely a reason to browse it. This is a
    search box instead: type a nickname, find the one member you're looking for, and ban
    (remove_member) them if that's why you're here. Nothing renders until there's a query. */
export function MemberSearchBan({
  groupId,
  members,
  canBan,
}: {
  groupId: string;
  members: Member[];
  canBan: boolean;
}) {
  const [query, setQuery] = useState('');

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return members.filter((m) => m.nickname.toLowerCase().includes(q)).slice(0, 20);
  }, [query, members]);

  return (
    <div className="space-y-2">
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search by nickname…"
        className="w-full rounded-[10px] border border-espresso-200 bg-paper-white px-3.5 py-2.5 text-[15px] font-semibold text-espresso-950 focus:border-honey-500 focus:outline-none focus:ring-2 focus:ring-honey-200"
      />
      {query.trim() && (
        <div className="divide-y divide-espresso-50 rounded-[14px] border border-espresso-100 bg-paper-white">
          {results.length === 0 ? (
            <p className="px-4 py-3 text-sm text-espresso-400">No match.</p>
          ) : (
            results.map((m) => (
              <div key={m.userId} className="flex items-center justify-between gap-3 px-4 py-3">
                <span className="min-w-0 truncate text-sm text-espresso-800">
                  <Mention nickname={m.nickname} className="font-semibold" />
                  {m.isOwner && <span className="ml-1.5 text-[11.5px] font-bold text-honey-700">owner</span>}
                  {m.isModerator && !m.isOwner && <span className="ml-1.5 text-[11.5px] font-bold text-espresso-500">mod</span>}
                </span>
                {canBan && !m.isOwner ? (
                  <RemoveMemberButton groupId={groupId} userId={m.userId} nickname={m.nickname} />
                ) : null}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
