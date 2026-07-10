'use client';

import { useEffect, useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { friendlyTimezoneName } from '@/lib/timezone';

function formatRemaining(ms: number): string {
  if (ms <= 0) return 'closed';
  const totalMinutes = Math.floor(ms / 60_000);
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

/**
 * Ticks every 30s — good enough resolution for "closes in 2h 15m" style copy
 * without a re-render storm. When `clickable`, tapping it opens a modal with
 * the exact date/time (in the viewer's own device zone, named explicitly) —
 * a countdown doesn't need a persistent time-zone caption next to it, but
 * the exact moment should still be one tap away.
 */
export function CountdownTimer({
  target,
  prefix = 'closes in',
  clickable = false,
}: {
  target: string;
  prefix?: string;
  clickable?: boolean;
}) {
  const [now, setNow] = useState<number | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [deviceTimezone, setDeviceTimezone] = useState<string | null>(null);

  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!clickable) return;
    try {
      setDeviceTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone);
    } catch {
      // stays null — modal just omits the zone name
    }
  }, [clickable]);

  // Avoids a hydration mismatch: render nothing until mounted, since "now" is inherently client-only.
  if (now === null) return null;

  const remaining = new Date(target).getTime() - now;
  const label = remaining <= 0 ? 'closed' : [prefix, formatRemaining(remaining)].filter(Boolean).join(' ');

  if (!clickable) return <span>{label}</span>;

  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setShowDetails(true);
        }}
        className="underline decoration-dotted decoration-espresso-300 underline-offset-2"
      >
        {label}
      </button>
      {showDetails && (
        <Modal onClose={() => setShowDetails(false)}>
          <p className="font-display font-bold text-espresso-900">Betting closes</p>
          <p className="text-sm text-espresso-600">
            {new Date(target).toLocaleString(undefined, { dateStyle: 'full', timeStyle: 'short' })}
            {deviceTimezone && ` (${friendlyTimezoneName(deviceTimezone)})`}
          </p>
          <Button className="w-full" onClick={() => setShowDetails(false)}>
            Got it
          </Button>
        </Modal>
      )}
    </>
  );
}
