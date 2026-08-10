import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

export type Tone = 'neutral' | 'honey' | 'success' | 'danger' | 'ink';

/** bg/text pairing per status tone — shared with anything that needs to tint a surface by market status (e.g. market row icon tiles), not just the pill badge below.
 * `ink` is the "live" tier of the market-status 3-tone system (see lib/marketStatus.ts): solid dark fill, reserved for "money's on the line right now" — never honey, which means money-the-figure, not money-in-play. */
export const TONE_CLASSES: Record<Tone, string> = {
  neutral: 'bg-espresso-50 text-espresso-600',
  honey: 'bg-honey-100 text-honey-800',
  success: 'bg-success-100 text-success-700',
  danger: 'bg-danger-100 text-danger-700',
  ink: 'bg-espresso-800 text-paper-white',
};

export function Badge({ tone = 'neutral', className, ...props }: HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
  return (
    <span
      className={cn('inline-flex shrink-0 items-center whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold', TONE_CLASSES[tone], className)}
      {...props}
    />
  );
}
