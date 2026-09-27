'use client';

import { useState } from 'react';
import { cn } from '@/lib/cn';

/**
 * 4f/4r's two lenses: "This season" and "All time", as the same segmented control the market list
 * uses (4a). Both panes are server-rendered up front and just toggled — no client fetch. The
 * header above the control is a render prop because its subtitle and the Settings button change
 * with the lens (4r drops Settings and reads "4 seasons since March 2026"). Without an all-time
 * pane (seasons off) there's nothing to switch between, so the control isn't drawn.
 */
export function LeaderboardLenses({
  initialLens,
  currentLabel = 'This season',
  header,
  current,
  allTime,
}: {
  initialLens: 'current' | 'alltime';
  currentLabel?: string;
  header: (lens: 'current' | 'alltime') => React.ReactNode;
  current: React.ReactNode;
  allTime: React.ReactNode;
}) {
  const [lens, setLens] = useState(initialLens);

  return (
    <div>
      {header(lens)}
      {allTime && (
        <div className="mt-[13px] flex gap-1 rounded-[15px] bg-rule p-1">
          {(['current', 'alltime'] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setLens(k)}
              className={cn(
                'flex flex-1 items-center justify-center rounded-[11px] py-[9px] text-[12.5px] transition-[background-color,box-shadow] duration-200',
                lens === k ? 'bg-surface font-bold text-ink shadow-[0_1px_2px_rgba(12,16,24,0.07)]' : 'font-semibold text-muted'
              )}
            >
              {k === 'current' ? currentLabel : 'All time'}
            </button>
          ))}
        </div>
      )}
      <div className="mt-3">
        <div className={lens === 'current' ? '' : 'hidden'}>{current}</div>
        {allTime && <div className={lens === 'alltime' ? '' : 'hidden'}>{allTime}</div>}
      </div>
    </div>
  );
}
