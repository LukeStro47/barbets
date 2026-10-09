'use client';

import { useMemo, useState } from 'react';
import { EmptyState } from '@/components/ui/EmptyState';
import { Button } from '@/components/ui/Button';
import type { MarketCardData } from '@/components/markets/MarketCard';
import { MarketCardList } from '@/components/markets/MarketListCard';
import { loadMoreSettledMarkets } from '@/lib/actions/feed';
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
  // "Closing soonest" (4a's section label) means what it says — nearest deadline first, not
  // newest-created-first like every other bucket still is.
  const openByClosingSoonest = useMemo(() => [...open].sort((a, b) => new Date(a.closesAt).getTime() - new Date(b.closesAt).getTime()), [open]);
  const openEmpty = open.length === 0;
  const pendingCount = pendingSponsor.length + awaitingResolution.length + challenged.length;
  const pendingEmpty = pendingCount === 0;
  const nothingActive = openEmpty && pendingEmpty;
  // The segmented control's pending dot means "something needs you specifically" — narrower
  // than the count next to it, which includes markets merely waiting on someone else.
  const pendingNeedsYou = pendingSponsor.some((m) => m.canEndorse);

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

  return (
    <div className="flex flex-col">
      {!allEmpty && (
        <div className="flex gap-1 rounded-[15px] bg-rule p-1">
          {TABS.map((tab) => {
            const count = tab.key === 'open' ? open.length : tab.key === 'pending' ? pendingCount : null;
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => setFilter(tab.key)}
                className={cn(
                  'flex flex-1 items-center justify-center gap-[5px] rounded-[11px] py-[9px] text-center text-[12.5px] transition-[background-color,box-shadow] duration-200',
                  filter === tab.key ? 'bg-surface font-bold text-ink shadow-[0_1px_2px_rgba(12,16,24,0.07)]' : 'font-semibold text-muted'
                )}
              >
                {tab.label}
                {count !== null && <span className="font-mono font-semibold text-faint">{count}</span>}
                {tab.key === 'pending' && pendingNeedsYou && <span className="h-[6px] w-[6px] rounded-full bg-alert" />}
              </button>
            );
          })}
        </div>
      )}

      {effectiveFilter === 'open' && (
        <Section label={openEmpty ? 'Markets' : 'Closing soonest'} className="mt-2.5">
          {openEmpty ? (
            allEmpty ? (
              <EmptyState icon="🎲" title="Nothing open right now" subtitle="Tap the + below to start one." />
            ) : nothingActive ? (
              <EmptyState
                icon="🎲"
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
                icon="🎲"
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
            <MarketCardList markets={openByClosingSoonest} />
          )}
        </Section>
      )}

      {effectiveFilter === 'pending' && (
        <div className="mt-3.5">
          {/* 4b draws the pending tab as one unlabelled stack — each card's own stat row already
              says which stage it's at (Proposed by / Called by), so a heading per stage repeated it. */}
          {!pendingEmpty && <MarketCardList markets={[...pendingSponsor, ...challenged, ...awaitingResolution]} gap={10} />}
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
        </div>
      )}

      {effectiveFilter === 'settled' && (
        <Section label="Settled" className="mt-2.5">
          {settled.length === 0 ? (
            <EmptyState icon="🏁" title="No settled markets yet" subtitle="Once a market resolves, it'll show up here." />
          ) : (
            <>
              <MarketCardList markets={settled} />
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

function Section({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-col gap-[9px]', className)}>
      <h2 className="text-[11px] font-bold tracking-[0.1em] text-faint uppercase">{label}</h2>
      {children}
    </div>
  );
}
