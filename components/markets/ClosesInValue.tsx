'use client';

import { useEffect, useState } from 'react';
import { CountdownTimer } from '@/components/ui/CountdownTimer';

const URGENT_THRESHOLD_MS = 60 * 60 * 1000;

/**
 * The "Closes in" figure for the market stat strip: the countdown, plus a breathing red once the
 * market is inside its last hour.
 *
 * Ticks on its own 30s cadence rather than reading a value frozen at page load — the person most
 * likely to care is the one sitting on the page as it closes, and for them a one-shot check at
 * render would never flip on at all. The urgency lives in colour (breathing to alert-red) rather
 * than the signal-blue this cell's value already renders in.
 */
export function ClosesInValue({ closesAt }: { closesAt: string }) {
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const remainingMs = now === null ? null : new Date(closesAt).getTime() - now;
  const urgent = remainingMs !== null && remainingMs > 0 && remainingMs <= URGENT_THRESHOLD_MS;

  return (
    <span className={urgent ? 'animate-urgent-breathe' : undefined}>
      <CountdownTimer target={closesAt} prefix="" clickable />
    </span>
  );
}
