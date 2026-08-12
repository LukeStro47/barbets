'use client';

import { useEffect, useState } from 'react';
import { formatTokens } from '@/lib/formatNumber';
import { getGroupBalanceSnapshots, type GroupBalanceSnapshot } from '@/lib/offlineSnapshot';

// Read from localStorage on mount rather than at module scope: this whole page can be served
// from the service worker's cache of the HTML captured at install time (see public/sw.js), so
// nothing here can assume it's running a fresh server render — it has to pull what's actually
// on the device right now, client-side, same as the offline check itself.
export function OfflineGroupBalances() {
  const [snapshots, setSnapshots] = useState<GroupBalanceSnapshot[]>([]);

  useEffect(() => {
    setSnapshots(getGroupBalanceSnapshots());
  }, []);

  if (snapshots.length === 0) return null;

  return (
    <div className="mt-7 w-full max-w-[330px] rounded-[20px] border border-espresso-100 bg-paper-white px-5 py-4 text-left">
      <p className="text-[11px] font-bold tracking-[1.6px] text-espresso-500 uppercase">Last known balances</p>
      <ul className="mt-2.5 flex flex-col gap-2.5">
        {snapshots.map((s) => (
          <li key={s.groupId} className="flex items-baseline justify-between gap-3 text-[15px]">
            <span className="min-w-0 truncate text-espresso-900">{s.groupName}</span>
            <span className="shrink-0 font-bold text-honey-700">{formatTokens(s.balance)}</span>
          </li>
        ))}
      </ul>
      {/* One caption for the whole box rather than a per-row age: every figure here is stale by
          definition, and the exact minute count isn't what anyone reads it for. */}
      <p className="mt-3 text-[11px] text-espresso-400">
        Saved before you went offline, so these may be out of date.
      </p>
    </div>
  );
}
