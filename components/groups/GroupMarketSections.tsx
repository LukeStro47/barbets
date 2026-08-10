'use client';

import { useState } from 'react';
import { EmptyState } from '@/components/ui/EmptyState';
import { Button } from '@/components/ui/Button';
import { MarketRowList, type MarketCardData } from '@/components/markets/MarketCard';
import { STATUS_LABEL } from '@/lib/marketStatus';
import { cn } from '@/lib/cn';

type Filter = 'open' | 'pending' | 'settled';

const TABS: { key: Filter; label: string }[] = [
  { key: 'open', label: 'Open' },
  { key: 'pending', label: 'Pending' },
  { key: 'settled', label: 'Settled' },
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
  const [filter, setFilter] = useState<Filter>('open');
  const openEmpty = open.length === 0;
  const pendingEmpty = pendingSponsor.length === 0 && awaitingResolution.length === 0 && challenged.length === 0;
  const nothingActive = openEmpty && pendingEmpty;

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
          {revealed.length === 0 ? (
            <EmptyState icon="🏁" title="No settled markets yet" subtitle="Once a market resolves, it'll show up here." />
          ) : (
            <MarketRowList markets={revealed} />
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
