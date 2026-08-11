'use client';

import { useEffect, useState } from 'react';
import { StatTile } from '@/components/markets/StatStrip';
import { CountdownTimer } from '@/components/ui/CountdownTimer';

const URGENT_THRESHOLD_MS = 60 * 60 * 1000;

/** Wraps the "Closes in" StatTile so its urgent (breathing-border) state is live — ticking on the
 * same 30s cadence as CountdownTimer's own text — instead of a one-shot value frozen at page load,
 * which would otherwise never flip on for someone who has the market page open as it closes. */
export function ClosesInStatTile({ closesAt }: { closesAt: string }) {
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const remainingMs = now === null ? null : new Date(closesAt).getTime() - now;
  const urgent = remainingMs !== null && remainingMs > 0 && remainingMs <= URGENT_THRESHOLD_MS;

  return <StatTile label="Closes in" urgent={urgent} value={<CountdownTimer target={closesAt} prefix="" clickable />} />;
}
