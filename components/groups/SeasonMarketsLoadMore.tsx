'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { MarketRowList, type MarketCardData } from '@/components/markets/MarketCard';
import { loadMoreSettledMarkets } from '@/lib/actions/feed';
import type { SettledCursor } from '@/lib/groupFeed';

/** The /seasons archive route's settled list + "Load more" — same shape as
 * GroupMarketSections' Settled tab, just without the tab strip around it and threading a
 * `seasonId` through so paging stays inside the season the chips selected. */
export function SeasonMarketsLoadMore({
  groupId,
  seasonId,
  initialMarkets,
  initialCursor,
}: {
  groupId: string;
  seasonId?: string;
  initialMarkets: MarketCardData[];
  initialCursor: SettledCursor | null;
}) {
  const [extraPages, setExtraPages] = useState<MarketCardData[][]>([]);
  const [cursor, setCursor] = useState<SettledCursor | null>(initialCursor);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const markets = [...initialMarkets, ...extraPages.flat()];

  async function loadMore() {
    if (!cursor || loading) return;
    setLoading(true);
    setError(null);
    const result = await loadMoreSettledMarkets(groupId, cursor, seasonId);
    setLoading(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setExtraPages((pages) => [...pages, result.data!.markets]);
    setCursor(result.data!.nextCursor);
  }

  return (
    <>
      <MarketRowList markets={markets} />
      {cursor && (
        <div className="flex flex-col items-center gap-2 pt-1">
          {error && <p className="text-xs text-danger-700">{error}</p>}
          <Button variant="outline" size="sm" onClick={loadMore} disabled={loading}>
            {loading ? 'Loading…' : 'Load more'}
          </Button>
        </div>
      )}
    </>
  );
}
