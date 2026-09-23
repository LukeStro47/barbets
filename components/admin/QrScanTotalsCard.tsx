import type { QrScanTotal } from '@/lib/actions/admin';

function formatAgo(iso: string): string {
  const mins = (Date.now() - new Date(iso).getTime()) / 60_000;
  if (mins < 1) return 'just now';
  if (mins < 60) return `${Math.round(mins)}m ago`;
  const hours = mins / 60;
  if (hours < 48) return `${Math.round(hours)}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export function QrScanTotalsCard({ totals }: { totals: QrScanTotal[] }) {
  if (totals.length === 0) {
    return <p className="text-sm text-faint">No scans logged yet.</p>;
  }

  return (
    <div className="divide-y divide-rule rounded-xl border border-hairline">
      {totals.map((t) => (
        <div key={t.batch} className="flex items-center justify-between gap-3 px-3 py-2.5">
          <div>
            <p className="text-sm font-semibold text-ink">/go/{t.batch}</p>
            <p className="text-xs text-faint">
              {t.android_count} Android, {t.ios_count} iOS, {t.other_count} other &middot; last {formatAgo(t.last_scanned_at)}
            </p>
          </div>
          <p className="font-display text-xl font-bold text-ink">{t.total_count}</p>
        </div>
      ))}
    </div>
  );
}
