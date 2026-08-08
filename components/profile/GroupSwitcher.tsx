'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/cn';

export interface SwitcherGroup {
  id: string;
  name: string;
  initials: string;
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
        className="flex w-full items-center gap-[13px] rounded-[22px] border border-espresso-100 bg-paper-white px-4 py-3.5 text-left"
      >
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-espresso-900 text-sm font-extrabold text-honey-300">
          {current.initials}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[10px] font-extrabold tracking-[0.1em] text-espresso-400 uppercase">Showing</span>
          <span className="mt-0.5 block truncate text-[19px] font-extrabold tracking-[-0.015em] text-espresso-900">{current.name}</span>
        </span>
        {groups.length > 1 && (
          <span className={cn('flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full bg-espresso-50 text-[10px] text-espresso-500 transition-transform', open && 'rotate-180')}>
            ▾
          </span>
        )}
      </button>

      {open && groups.length > 1 && (
        <>
          <div onClick={() => setOpen(false)} className="fixed inset-0 z-20" />
          <div className="absolute inset-x-0 top-[calc(100%+6px)] z-30 rounded-[20px] border border-espresso-100 bg-paper-white p-1.5 shadow-[0_22px_40px_-20px_rgba(28,19,13,0.55)]">
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
                    active ? 'bg-honey-500/10' : 'bg-transparent'
                  )}
                >
                  <span className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[10px] bg-espresso-900 text-[10.5px] font-extrabold text-honey-300">
                    {g.initials}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={cn('block truncate text-[13.5px] font-extrabold', active ? 'text-honey-700' : 'text-espresso-900')}>
                      {g.name}
                    </span>
                    <span className="mt-px block truncate text-[11.5px] italic text-espresso-400">@{g.handle}</span>
                  </span>
                  {active && <span className="shrink-0 text-[10px] text-honey-600">●</span>}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
