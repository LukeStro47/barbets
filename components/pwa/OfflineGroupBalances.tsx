'use client';

import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/Card';
import { formatTokens } from '@/lib/formatNumber';
import { getGroupBalanceSnapshots, type GroupBalanceSnapshot } from '@/lib/offlineSnapshot';

function timeAgo(savedAt: string): string {
  const minutes = Math.round((Date.now() - new Date(savedAt).getTime()) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

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
    <div className="mt-10 w-full max-w-xs text-left">
      <p className="text-center text-[11px] font-bold tracking-[0.12em] text-espresso-400 uppercase">
        Last known balances
      </p>
      <ul className="mt-3 space-y-2">
        {snapshots.map((s) => (
          <li key={s.groupId}>
            <Card className="flex items-center justify-between px-4 py-3">
              <span className="min-w-0 truncate font-medium text-espresso-800">{s.groupName}</span>
              <span className="shrink-0 text-right">
                <span className="block font-display font-bold text-espresso-900">{formatTokens(s.balance)} tokens</span>
                <span className="block text-xs text-espresso-400">as of {timeAgo(s.savedAt)}</span>
              </span>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}
