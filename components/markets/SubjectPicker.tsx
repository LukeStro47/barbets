'use client';

import { useMemo, useState } from 'react';
import { Mention } from '@/components/ui/Mention';

export interface MemberOption {
  userId: string;
  nickname: string;
}

/** Typeahead @mention picker for a market's subjects — the privacy-critical "About" field. */
export function SubjectPicker({
  members,
  selected,
  onChange,
  totalMemberCount,
}: {
  members: MemberOption[];
  selected: MemberOption[];
  onChange: (next: MemberOption[]) => void;
  /** Total active group members (including the creator), used to show the subject cap. */
  totalMemberCount: number;
}) {
  const [query, setQuery] = useState('');
  const maxSubjects = Math.max(0, totalMemberCount - 2);
  const atCap = selected.length >= maxSubjects;

  const suggestions = useMemo(() => {
    if (!query || atCap) return [];
    const q = query.toLowerCase().replace(/^@/, '');
    return members
      .filter((m) => !selected.some((s) => s.userId === m.userId))
      .filter((m) => m.nickname.toLowerCase().includes(q))
      .slice(0, 6);
  }, [query, members, selected, atCap]);

  return (
    <div className="space-y-2">
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {selected.map((m) => (
            <button
              type="button"
              key={m.userId}
              onClick={() => onChange(selected.filter((s) => s.userId !== m.userId))}
              className="inline-flex items-center gap-1 rounded-full bg-honey-100 px-3 py-1 text-sm font-semibold text-honey-800"
            >
              <Mention nickname={m.nickname} /> <span aria-hidden>×</span>
            </button>
          ))}
        </div>
      )}
      <div className="relative">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={atCap ? `Max ${maxSubjects} subject${maxSubjects === 1 ? '' : 's'} for a group this size` : 'Type a nickname to @mention…'}
          disabled={atCap}
          className="w-full rounded-xl border border-espresso-200 bg-paper-white px-4 py-2.5 text-espresso-900 placeholder:text-espresso-300 focus:border-honey-500 focus:outline-none focus:ring-2 focus:ring-honey-200 disabled:bg-espresso-50"
        />
        {suggestions.length > 0 && (
          <ul className="absolute z-10 mt-1 w-full overflow-hidden rounded-xl border border-espresso-100 bg-paper-white shadow-lg">
            {suggestions.map((m) => (
              <li key={m.userId}>
                <button
                  type="button"
                  onClick={() => {
                    onChange([...selected, m]);
                    setQuery('');
                  }}
                  className="block w-full px-4 py-2 text-left text-espresso-800 hover:bg-honey-50"
                >
                  <Mention nickname={m.nickname} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <p className="text-xs text-espresso-400">
        Anyone you @mention here won't be able to see this market exists until it resolves.
      </p>
    </div>
  );
}
