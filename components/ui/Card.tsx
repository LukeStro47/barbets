import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('rounded-2xl border border-espresso-100 bg-paper-white p-5 shadow-sm shadow-espresso-900/5', className)}
      {...props}
    />
  );
}
