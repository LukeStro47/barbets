import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

export type Tone = 'neutral' | 'signal' | 'honey' | 'success' | 'danger' | 'ink' | 'gain' | 'alert';

/** bg/text pairing per status tone. `ink` = live money on the line; `signal` = actionable/live chrome;
 * `gain` = realised gain; `alert` = needs you / destructive. `honey`/`success`/`danger` kept as aliases. */
export const TONE_CLASSES: Record<Tone, string> = {
  neutral: 'bg-rule text-muted',
  signal: 'bg-signal-tint text-signal',
  honey: 'bg-signal-tint text-signal',
  success: 'bg-gain-bg text-gain',
  gain: 'bg-gain-bg text-gain',
  danger: 'bg-alert-bg text-alert',
  alert: 'bg-alert-bg text-alert',
  ink: 'bg-ink text-white',
};

export function Badge({ tone = 'neutral', className, ...props }: HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center whitespace-nowrap rounded-[8px] px-2.5 py-1 text-[11.5px] font-bold',
        TONE_CLASSES[tone],
        className
      )}
      {...props}
    />
  );
}
