'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { setGroupAvatar } from '@/lib/actions/groups';
import { GROUP_AVATARS } from '@/lib/avatars';
import { initials } from '@/lib/initials';
import { cn } from '@/lib/cn';

/** Owner-only grid of the built-in group logos, plus an "initials" tile that clears the choice.
 * Saves on tap rather than behind a Save button: it's a single value with an instantly visible
 * result, so a confirm step would only add a click between the pick and seeing it. The selection
 * is applied optimistically so the highlight moves immediately, and rolls back if the action
 * rejects (a non-owner racing an ownership transfer, mainly). */
export function AvatarPicker({ groupId, groupName, avatarKey }: { groupId: string; groupName: string; avatarKey: string | null }) {
  const router = useRouter();
  const [selected, setSelected] = useState<string | null>(avatarKey);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function pick(key: string | null) {
    if (key === selected) return;
    const previous = selected;
    setSelected(key);
    setError(null);
    startTransition(async () => {
      const result = await setGroupAvatar(groupId, key);
      if (result.error) {
        setSelected(previous);
        setError(result.error);
      } else {
        router.refresh();
      }
    });
  }

  const tileClasses = 'flex h-14 w-14 items-center justify-center overflow-hidden rounded-[16px] border-[1.5px] transition-colors';

  return (
    <div className="space-y-2.5">
      {error && <p className="text-sm text-danger-700">{error}</p>}
      <div className="flex flex-wrap gap-2.5">
        <button
          type="button"
          disabled={isPending}
          onClick={() => pick(null)}
          aria-pressed={selected === null}
          title="Use the group's initials"
          className={cn(
            tileClasses,
            'text-[15px] font-extrabold',
            selected === null ? 'border-honey-500 bg-honey-50 text-honey-800' : 'border-espresso-200 bg-paper-white text-espresso-400'
          )}
        >
          {initials(groupName)}
        </button>
        {GROUP_AVATARS.map((a) => (
          <button
            key={a.key}
            type="button"
            disabled={isPending}
            onClick={() => pick(a.key)}
            aria-pressed={selected === a.key}
            title={a.label}
            className={cn(tileClasses, selected === a.key ? 'border-honey-500 bg-honey-50' : 'border-espresso-200 bg-paper-white')}
          >
            <img src={`/avatars/${a.key}.png`} alt={a.label} className="h-full w-full object-cover" />
          </button>
        ))}
      </div>
    </div>
  );
}
