'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/cn';
import { GroupAvatar } from '@/components/ui/GroupAvatar';
import { CaretDownIcon } from '@/components/ui/icons';

export interface SwitcherGroup {
  id: string;
  name: string;
  avatarKey: string | null;
  handle: string;
}

/** The control at the top of /profile — big, tappable, definitive: this is the scope of the
 * whole page below it. Switching updates the ?group= query param rather than navigating away,
 * so the rest of the page (a server component) re-fetches scoped to the new group. */
export function GroupSwitcher({ groups, currentGroupId }: { groups: SwitcherGroup[]; currentGroupId: string }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const current = groups.find((g) => g.id === currentGroupId) ?? groups[0];
  if (!current) return null;

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-[13px] rounded-[22px] border border-hairline bg-surface px-4 py-3.5 text-left"
      >
        <GroupAvatar
          name={current.name}
          avatarKey={current.avatarKey}
          className="h-11 w-11 text-sm"
          fallbackClassName="bg-ink text-on-ink"
        />
        <span className="min-w-0 flex-1">
          <span className="block text-[10px] font-extrabold tracking-[0.1em] text-faint uppercase">Showing</span>
          <span className="mt-0.5 block truncate text-[19px] font-extrabold tracking-[-0.015em] text-ink">{current.name}</span>
        </span>
        {groups.length > 1 && (
          // A drawn caret, not a "▾" glyph: the glyph's position inside its em box is the font's
          // decision, so scaling it up drifts off-centre in the circle. Same reasoning as
          // MarketOverflowMenu's dots.
          <span
            className={cn(
              'flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-rule text-muted transition-transform',
              open && 'rotate-180'
            )}
          >
            <CaretDownIcon className="h-[17px] w-[17px]" />
          </span>
        )}
      </button>

      {open && groups.length > 1 && (
        <>
          <div onClick={() => setOpen(false)} className="fixed inset-0 z-20" />
          <div className="absolute inset-x-0 top-[calc(100%+6px)] z-30 rounded-[20px] border border-hairline bg-surface p-1.5 shadow-[0_22px_40px_-20px_rgba(28,19,13,0.55)]">
            {groups.map((g) => {
              const active = g.id === current.id;
              return (
                <button
                  key={g.id}
                  onClick={() => {
                    setOpen(false);
                    router.push(`/profile?group=${g.id}`);
                  }}
                  className={cn(
                    'flex w-full items-center gap-[11px] rounded-2xl px-[11px] py-2.5 text-left',
                    active ? 'bg-signal/10' : 'bg-transparent'
                  )}
                >
                  <GroupAvatar
                    name={g.name}
                    avatarKey={g.avatarKey}
                    className="h-[30px] w-[30px] text-[10.5px]"
                    fallbackClassName="bg-ink text-on-ink"
                  />
                  <span className="min-w-0 flex-1">
                    <span className={cn('block truncate text-[13.5px] font-extrabold', active ? 'text-signal' : 'text-ink')}>
                      {g.name}
                    </span>
                    <span className="mt-px block truncate text-[11.5px] italic text-faint">@{g.handle}</span>
                  </span>
                  {active && <span className="shrink-0 text-[10px] text-signal">●</span>}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
