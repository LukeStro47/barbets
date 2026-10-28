'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { cn } from '@/lib/cn';

type Tab = 'market' | 'comments';

/**
 * The Market / Comments tab pair: 13.5px, a 2px ink underline on the active one.
 *
 * Client-side only so the underline can move the moment a tab is tapped. Switching tabs is a
 * full server render of the market page, and with nothing changing on screen until it lands,
 * the tap read as ignored. `pending` is dropped once the server's own `active` catches up.
 */
export function MarketTabs({
  groupId,
  marketId,
  active,
  commentCount,
  className,
}: {
  groupId: string;
  marketId: string;
  active: Tab;
  commentCount: number;
  className?: string;
}) {
  const [pending, setPending] = useState<Tab | null>(null);
  useEffect(() => setPending(null), [active]);
  const shown = pending ?? active;
  const base = `/groups/${groupId}/markets/${marketId}`;
  const tabClass = (tab: Tab) =>
    shown === tab ? 'font-bold text-ink shadow-[inset_0_-2px_0_var(--color-ink)]' : 'font-semibold text-faint';

  return (
    <div className={cn('flex gap-[22px]', className)}>
      <Link
        href={base}
        replace
        onClick={() => active !== 'market' && setPending('market')}
        className={cn('pb-2.5 text-[13.5px]', tabClass('market'))}
      >
        Market
      </Link>
      <Link
        href={`${base}?tab=comments`}
        replace
        onClick={() => active !== 'comments' && setPending('comments')}
        className={cn('inline-flex items-center gap-1.5 pb-2.5 text-[13.5px]', tabClass('comments'))}
      >
        Comments <span className="font-mono text-[12px] text-faint">{commentCount}</span>
      </Link>
    </div>
  );
}
