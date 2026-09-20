'use client';

import { useState } from 'react';
import { cn } from '@/lib/cn';

/** Both panes are server-rendered up front and just toggled with CSS — no client fetch, so there's
 * nothing to lose by keeping the inactive one mounted. `initialLens` lets a season-history
 * pagination link (?lens=alltime&page=2) land back on the tab it came from instead of resetting
 * to Current on every navigation. */
export function LeaderboardLenses({
  initialLens,
  currentLabel = 'Current standings',
  current,
  allTime,
}: {
  initialLens: 'current' | 'alltime';
  /** "Season N final" once the season's over — the lens is frozen standings, not "current"
   * anything, by the time this label matters. */
  currentLabel?: string;
  current: React.ReactNode;
  allTime: React.ReactNode;
}) {
  const [lens, setLens] = useState(initialLens);

  return (
    <div>
      <div className="mb-4 flex gap-1 rounded-full bg-rule p-1">
        {(['current', 'alltime'] as const).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setLens(k)}
            className={cn(
              'flex-1 rounded-full py-2 text-[12.5px] font-bold transition-colors',
              lens === k ? 'bg-surface text-ink shadow-sm' : 'text-faint hover:text-muted'
            )}
          >
            {k === 'current' ? currentLabel : 'All-time'}
          </button>
        ))}
      </div>
      <div className={lens === 'current' ? '' : 'hidden'}>{current}</div>
      <div className={lens === 'alltime' ? '' : 'hidden'}>{allTime}</div>
    </div>
  );
}
