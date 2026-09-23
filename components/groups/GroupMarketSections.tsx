'use client';

import { useMemo, useState } from 'react';
import { EmptyState } from '@/components/ui/EmptyState';
import { Button } from '@/components/ui/Button';
import { MarketFeedList, MarketRowList, type MarketCardData } from '@/components/markets/MarketCard';
import { loadMoreSettledMarkets } from '@/lib/actions/feed';
import { STATUS_LABEL } from '@/lib/marketStatus';
import type { SettledCursor } from '@/lib/groupFeed';
import { cn } from '@/lib/cn';

type Filter = 'open' | 'pending' | 'settled';

export function GroupMarketSections({
  groupId,
  pendingSponsor,
  open,
  awaitingResolution,
  challenged,
  revealed,
  revealedNextCursor,
  seasonId,
}: {
  groupId: string;
  pendingSponsor: MarketCardData[];
  open: MarketCardData[];
  awaitingResolution: MarketCardData[];
  challenged: MarketCardData[];
  /** The first page only. Settled markets accumulate for the life of a group, so the rest arrive through "Load more". */
  revealed: MarketCardData[];
  revealedNextCursor: SettledCursor | null;
  /** Scopes "Load more" to the same season the first page was fetched with — omitted for a seasons-off group, which pages the all-time feed. */
  seasonId?: string;
}) {
  const openSorted = useMemo(
    () => [...open].sort((a, b) => new Date(a.closesAt).getTime() - new Date(b.closesAt).getTime()),
    [open]
  );
  const pendingCount = pendingSponsor.length + awaitingResolution.length + challenged.length;
  const openEmpty = openSorted.length === 0;
  const pendingEmpty = pendingCount === 0;
  const nothingActive = openEmpty && pendingEmpty;

  // Default to the first tab, in open -> pending -> settled order, that actually has something
  // in it — landing on an empty "Open" tab when everything's already settled just makes someone
  // click through the other two tabs to find where the markets actually are.
  const [filter, setFilter] = useState<Filter>(() => {
    if (!openEmpty) return 'open';
    if (!pendingEmpty) return 'pending';
    return 'settled';
  });

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
    const result = await loadMoreSettledMarkets(groupId, cursor, seasonId);
    setLoadingMore(false);
    if (result.error) {
      setLoadError(result.error);
      return;
    }
    setExtraPages((pages) => [...pages, result.data!.markets]);
    setCursor(result.data!.nextCursor);
  }

  // Nothing anywhere: showing three tabs that all say "nothing here" (and a "View settled"
  // button that leads to yet another empty tab) is just navigation with no destination. Collapse
  // straight to the Open tab's plain empty state instead, with no tab bar and no dead-end button.
  const allEmpty = openEmpty && pendingEmpty && settled.length === 0;
  const effectiveFilter: Filter = allEmpty ? 'open' : filter;

  const tabs: { key: Filter; label: string; count?: number; alert?: boolean }[] = [
    { key: 'open', label: 'Open', count: openSorted.length },
    { key: 'pending', label: 'Pending', count: pendingCount, alert: pendingCount > 0 },
    { key: 'settled', label: 'Settled' },
  ];

  return (
    <div className="flex flex-col gap-[22px]">
      {!allEmpty && (
        <div className="flex rounded-[14px] bg-rule p-1">
          {tabs.map((tab) => {
            const on = filter === tab.key;
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => setFilter(tab.key)}
                className={cn(
                  'relative flex flex-1 items-center justify-center gap-1 rounded-[11px] px-2 py-2 text-[13px] font-bold transition-colors duration-150',
                  on ? 'bg-surface text-ink shadow-[var(--elevation-card)]' : 'bg-transparent text-muted'
                )}
              >
                <span>
                  {tab.label}
                  {tab.count != null && tab.count > 0 ? ` ${tab.count}` : ''}
                </span>
                {!on && tab.alert && (
                  <span className="absolute top-1.5 right-2 h-1.5 w-1.5 rounded-full bg-alert" aria-hidden />
                )}
              </button>
            );
          })}
        </div>
      )}

      {effectiveFilter === 'open' && (
        <Section label="Closing soonest">
          {openEmpty ? (
            allEmpty ? (
              <EmptyState icon="" title="Nothing open right now" subtitle="Tap the + below to start one." />
            ) : nothingActive ? (
              <EmptyState
                icon=""
                title="Nothing open right now"
                subtitle="Tap the + below to start one, or see what's already settled instead."
                action={
                  <Button variant="outline" size="sm" onClick={() => setFilter('settled')}>
                    View settled
                  </Button>
                }
              />
            ) : (
              <EmptyState
                icon=""
                title="Nothing open right now"
                subtitle="Tap the + below to start one, or check what's still pending."
                action={
                  <Button variant="outline" size="sm" onClick={() => setFilter('pending')}>
                    View pending
                  </Button>
                }
              />
            )
          ) : (
            <MarketFeedList markets={openSorted} />
          )}
        </Section>
      )}

      {effectiveFilter === 'pending' && (
        <div className="flex flex-col gap-[22px]">
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
                icon=""
                title="Nothing pending"
                subtitle="See what's already settled instead."
                action={
                  <Button variant="outline" size="sm" onClick={() => setFilter('settled')}>
                    View settled
                  </Button>
                }
              />
            ) : (
              <EmptyState icon="" title="Nothing pending" subtitle="No markets awaiting endorsement, resolution, or a vote." />
            ))}
        </div>
      )}

      {effectiveFilter === 'settled' && (
        <Section label="Settled">
          {settled.length === 0 ? (
            <EmptyState icon="" title="No settled markets yet" subtitle="Once a market resolves, it'll show up here." />
          ) : (
            <>
              <MarketRowList markets={settled} />
              {cursor && (
                <div className="flex flex-col items-center gap-2 pt-1">
                  {loadError && <p className="text-xs text-alert">{loadError}</p>}
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
    <div className="flex flex-col gap-[13px]">
      <h2 className="text-[11.5px] font-bold tracking-[0.1em] text-faint uppercase">{label}</h2>
      {children}
    </div>
  );
}
