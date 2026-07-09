import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

type Tone = 'neutral' | 'honey' | 'success' | 'danger';

const toneClasses: Record<Tone, string> = {
  neutral: 'bg-espresso-50 text-espresso-600',
  honey: 'bg-honey-100 text-honey-800',
  success: 'bg-success-100 text-success-700',
  danger: 'bg-danger-100 text-danger-700',
};

export function Badge({ tone = 'neutral', className, ...props }: HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
  return (
    <span
      className={cn('inline-flex shrink-0 items-center whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold', toneClasses[tone], className)}
      {...props}
    />
  );
}
