'use client';

import { useMemo, useState } from 'react';
import { EmptyState } from '@/components/ui/EmptyState';
import { Button } from '@/components/ui/Button';
import { MarketCard, MarketRowList, type MarketCardData } from '@/components/markets/MarketCard';
import { loadMoreSettledMarkets } from '@/lib/actions/feed';
import type { SettledCursor } from '@/lib/groupFeed';

const COPY = { icon: '🏈', badge: '🏈 Game of the Week', featuredLabel: 'This week', historyLabel: 'Past picks', emptyTitle: 'No game yet' };

/**
 * The NFL/CFB group hub feed: one always-featured market (this week's game) instead of the
 * ordinary Open/Pending/Settled tabs GroupMarketSections renders for every other group. The
 * featured slot always shows the most recent system market regardless of status — open (still
 * betting), closed (kickoff passed, no result yet), or already resolved/voided — so the group
 * never falls back to an empty "come back later" placeholder the moment one settles; it just
 * keeps showing that same market with its real outcome until the next one replaces it. Everything
 * older goes in the plain settled list below. See ARCHITECTURE.md's Phase 2 section.
 */
export function PipelineGroupFeed({
  groupId,
  featured,
  history,
  historyNextCursor,
}: {
  groupId: string;
  /** The current system market, whatever its status — null only when this group has never
   *  created one yet (a brand-new group before its first Tuesday run). */
  featured: MarketCardData | null;
  /** Settled markets older than `featured`, newest first. */
  history: MarketCardData[];
  historyNextCursor: SettledCursor | null;
}) {
  const copy = COPY;
  const [extraPages, setExtraPages] = useState<MarketCardData[][]>([]);
  const [cursor, setCursor] = useState<SettledCursor | null>(historyNextCursor);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const items = useMemo(() => {
    const seen = new Set<string>();
    return [...history, ...extraPages.flat()].filter((m) => {
      if (seen.has(m.id)) return false;
      seen.add(m.id);
      return true;
    });
  }, [history, extraPages]);

  async function loadMore() {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    setLoadError(null);
    const result = await loadMoreSettledMarkets(groupId, cursor);
    setLoadingMore(false);
    if (result.error) {
      setLoadError(result.error);
      return;
    }
    setExtraPages((pages) => [...pages, result.data!.markets]);
    setCursor(result.data!.nextCursor);
  }

  return (
    <div className="flex flex-col gap-[18px]">
      <div className="flex flex-col gap-2">
        <h2 className="ml-1 text-xs font-bold uppercase tracking-[0.08em] text-espresso-400">{copy.featuredLabel}</h2>
        {featured ? (
          <div className="flex flex-col gap-2">
            <span className="ml-1 inline-flex w-fit items-center rounded-full bg-honey-100 px-2.5 py-1 text-[10px] font-extrabold tracking-wide text-honey-800 uppercase">
              {copy.badge}
            </span>
            <MarketCard market={featured} />
          </div>
        ) : (
          <EmptyState icon={copy.icon} title={copy.emptyTitle} />
        )}
      </div>

      {items.length > 0 && (
        <div className="flex flex-col gap-2">
          <h2 className="ml-1 text-xs font-bold uppercase tracking-[0.08em] text-espresso-400">{copy.historyLabel}</h2>
          <MarketRowList markets={items} />
          {cursor && (
            <div className="flex flex-col items-center gap-2 pt-1">
              {loadError && <p className="text-xs text-danger-700">{loadError}</p>}
              <Button variant="outline" size="sm" onClick={loadMore} disabled={loadingMore}>
                {loadingMore ? 'Loading...' : 'Load more'}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
