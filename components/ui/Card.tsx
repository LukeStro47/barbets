import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'rounded-[24px] border border-hairline bg-surface p-5 shadow-[var(--elevation-card)]',
        className
      )}
      {...props}
    />
  );
}
