import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

export type Tone = 'neutral' | 'honey' | 'success' | 'danger';

/** bg/text pairing per status tone — shared with anything that needs to tint a surface by market status (e.g. market row icon tiles), not just the pill badge below. */
export const TONE_CLASSES: Record<Tone, string> = {
  neutral: 'bg-espresso-50 text-espresso-600',
  honey: 'bg-honey-100 text-honey-800',
  success: 'bg-success-100 text-success-700',
  danger: 'bg-danger-100 text-danger-700',
};

export function Badge({ tone = 'neutral', className, ...props }: HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
  return (
    <span
      className={cn('inline-flex shrink-0 items-center whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold', TONE_CLASSES[tone], className)}
      {...props}
    />
  );
}
