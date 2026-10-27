import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

/** Hairline border, no shadow — DESIGN.md rule 2: separation is a 1px rule, not elevation.
 *  Cards are white; canvas is the only grey. */
export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('rounded-[24px] border border-hairline bg-surface p-5', className)} {...props} />;
}
