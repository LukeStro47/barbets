'use client';

import { useMemo, useState } from 'react';
import { EmptyState } from '@/components/ui/EmptyState';
import { Button } from '@/components/ui/Button';
import { MarketRowList, type MarketCardData } from '@/components/markets/MarketCard';
import { loadMoreSettledMarkets } from '@/lib/actions/feed';
import { STATUS_LABEL } from '@/lib/marketStatus';
import type { SettledCursor } from '@/lib/groupFeed';
import { cn } from '@/lib/cn';

type Filter = 'open' | 'pending' | 'settled';

const TABS: { key: Filter; label: string }[] = [
  { key: 'open', label: 'Open' },
  { key: 'pending', label: 'Pending' },
  { key: 'settled', label: 'Settled' },
];

export function GroupMarketSections({
  groupId,
  pendingSponsor,
  open,
  awaitingResolution,
  challenged,
  revealed,
  revealedNextCursor,
}: {
  groupId: string;
  pendingSponsor: MarketCardData[];
  open: MarketCardData[];
  awaitingResolution: MarketCardData[];
  challenged: MarketCardData[];
  /** The first page only. Settled markets accumulate for the life of a group, so the rest arrive through "Load more". */
  revealed: MarketCardData[];
  revealedNextCursor: SettledCursor | null;
}) {
  const [filter, setFilter] = useState<Filter>('open');
  const openEmpty = open.length === 0;
  const pendingEmpty = pendingSponsor.length === 0 && awaitingResolution.length === 0 && challenged.length === 0;
  const nothingActive = openEmpty && pendingEmpty;

  // Later pages are kept separately from `revealed` rather than seeded into one piece of state,
  // so a server re-render (a reaction, a pull-to-refresh) still refreshes the first page instead
  // of being frozen out by a useState initial value. The dedupe covers the seam that creates: a
  // market resolving in between pushes page one's last row down into what page two already has.
  const [extraPages, setExtraPages] = useState<MarketCardData[][]>([]);
  const [cursor, setCursor] = useState<SettledCursor | null>(revealedNextCursor);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const settled = useMemo(() => {
    const seen = new Set<string>();
    return [...revealed, ...extraPages.flat()].filter((m) => {
      if (seen.has(m.id)) return false;
      seen.add(m.id);
      return true;
    });
  }, [revealed, extraPages]);

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
      <div className="flex gap-0.5 rounded-2xl bg-espresso-50 p-1">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setFilter(tab.key)}
            className={cn(
              'flex-1 rounded-xl py-[7px] text-center text-[13px] transition-[background-color,box-shadow,color] duration-200',
              filter === tab.key
                ? 'bg-paper-white font-semibold text-espresso-950 shadow-[0_1px_3px_rgba(44,31,23,0.12)]'
                : 'font-medium text-espresso-400'
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {filter === 'open' && (
        <Section label="Betting open">
          {openEmpty ? (
            nothingActive ? (
              <EmptyState
                icon="🎲"
                title="Nothing open right now"
                subtitle="See what's already settled instead."
                action={
                  <Button variant="outline" size="sm" onClick={() => setFilter('settled')}>
                    View settled
                  </Button>
                }
              />
            ) : (
              <EmptyState
                icon="🎲"
                title="Nothing open right now"
                subtitle="Something's still pending, though."
                action={
                  <Button variant="outline" size="sm" onClick={() => setFilter('pending')}>
                    View pending
                  </Button>
                }
              />
            )
          ) : (
            <MarketRowList markets={open} />
          )}
        </Section>
      )}

      {filter === 'pending' && (
        <>
          {pendingSponsor.length > 0 && (
            <Section label={STATUS_LABEL.pending_sponsor}>
              <MarketRowList markets={pendingSponsor} />
            </Section>
          )}
          {challenged.length > 0 && (
            <Section label={STATUS_LABEL.disputed}>
              <MarketRowList markets={challenged} />
            </Section>
          )}
          {awaitingResolution.length > 0 && (
            <Section label={STATUS_LABEL.closed}>
              <MarketRowList markets={awaitingResolution} />
            </Section>
          )}
          {pendingEmpty &&
            (nothingActive ? (
              <EmptyState
                icon="⏳"
                title="Nothing pending"
                subtitle="See what's already settled instead."
                action={
                  <Button variant="outline" size="sm" onClick={() => setFilter('settled')}>
                    View settled
                  </Button>
                }
              />
            ) : (
              <EmptyState icon="⏳" title="Nothing pending" subtitle="No markets awaiting endorsement, resolution, or a vote." />
            ))}
        </>
      )}

      {filter === 'settled' && (
        <Section label="Settled">
          {settled.length === 0 ? (
            <EmptyState icon="🏁" title="No settled markets yet" subtitle="Once a market resolves, it'll show up here." />
          ) : (
            <>
              <MarketRowList markets={settled} />
              {cursor && (
                <div className="flex flex-col items-center gap-2 pt-1">
                  {loadError && <p className="text-xs text-danger-700">{loadError}</p>}
                  <Button variant="outline" size="sm" onClick={loadMore} disabled={loadingMore}>
                    {loadingMore ? 'Loading...' : 'Load more'}
                  </Button>
                </div>
              )}
            </>
          )}
        </Section>
      )}
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <h2 className="ml-1 text-xs font-bold uppercase tracking-[0.08em] text-espresso-400">{label}</h2>
      {children}
    </div>
  );
}
