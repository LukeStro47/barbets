'use client';

import { useState } from 'react';
import { EmptyState } from '@/components/ui/EmptyState';
import { MarketRowList, type MarketCardData } from '@/components/markets/MarketCard';
import { cn } from '@/lib/cn';

type Filter = 'all' | 'open' | 'pending' | 'resolved';

const TABS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'open', label: 'Open' },
  { key: 'pending', label: 'Pending' },
  { key: 'resolved', label: 'Resolved' },
];

export function GroupMarketSections({
  pendingSponsor,
  open,
  awaitingResolution,
  challenged,
  revealed,
}: {
  pendingSponsor: MarketCardData[];
  open: MarketCardData[];
  awaitingResolution: MarketCardData[];
  challenged: MarketCardData[];
  revealed: MarketCardData[];
}) {
  const [filter, setFilter] = useState<Filter>('all');

  const showOpenGroup = filter === 'all' || filter === 'open';
  const showPendingGroup = filter === 'all' || filter === 'pending';
  const showResolvedGroup = filter === 'all' || filter === 'resolved';
  const pendingGroupEmpty = pendingSponsor.length === 0 && awaitingResolution.length === 0 && challenged.length === 0;

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

      {showPendingGroup && pendingSponsor.length > 0 && (
        <Section label="Awaiting endorsement">
          <MarketRowList markets={pendingSponsor} />
        </Section>
      )}

      {showOpenGroup && (
        <Section label="Open">
          {open.length === 0 ? (
            <EmptyState icon="🎲" title="Nothing open right now" subtitle="Start a market to get the pool going." />
          ) : (
            <MarketRowList markets={open} />
          )}
        </Section>
      )}

      {showPendingGroup && awaitingResolution.length > 0 && (
        <Section label="Awaiting resolution">
          <MarketRowList markets={awaitingResolution} />
        </Section>
      )}

      {showPendingGroup && challenged.length > 0 && (
        <Section label="Challenged">
          <MarketRowList markets={challenged} />
        </Section>
      )}

      {filter === 'pending' && pendingGroupEmpty && (
        <EmptyState icon="⏳" title="Nothing pending" subtitle="No markets awaiting endorsement, resolution, or a vote." />
      )}

      {showResolvedGroup && revealed.length > 0 && (
        <Section label="Resolved markets">
          <MarketRowList markets={filter === 'all' ? revealed.slice(0, 5) : revealed} />
          {filter === 'all' && revealed.length > 5 && (
            <button
              type="button"
              onClick={() => setFilter('resolved')}
              className="text-center text-xs font-medium text-espresso-400 underline"
            >
              See all {revealed.length} resolved markets
            </button>
          )}
        </Section>
      )}

      {filter === 'resolved' && revealed.length === 0 && (
        <EmptyState icon="🏁" title="No resolved markets yet" subtitle="Once a market resolves, it'll show up here." />
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
