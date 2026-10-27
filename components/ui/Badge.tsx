import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

export type Tone = 'neutral' | 'signal' | 'gain' | 'danger' | 'ink';

/** bg/text pairing per status tone — shared with anything that needs to tint a surface by market status (e.g. market row icon tiles), not just the pill badge below.
 * `ink` is the "live" tier of the market-status 3-tone system (see lib/marketStatus.ts): solid dark fill, reserved for "money's on the line right now" — signal blue stays the one accent for the live/actionable thing, not a status tint. */
export const TONE_CLASSES: Record<Tone, string> = {
  neutral: 'bg-rule text-muted',
  signal: 'bg-signal-tint text-signal-deep',
  gain: 'bg-gain-bg text-gain',
  danger: 'bg-alert-bg text-alert',
  ink: 'bg-ink text-surface',
};

export function Badge({ tone = 'neutral', className, ...props }: HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
  return (
    <span
      className={cn('inline-flex shrink-0 items-center whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold', TONE_CLASSES[tone], className)}
      {...props}
    />
  );
}
