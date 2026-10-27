'use client';

import { useState, type InputHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

/**
 * The bordered field every pre-group form uses (5b, 5c, 5f...): an uppercase caption above a
 * 56px box, 16px radius, hairline border; focus goes to a 1.5px signal border with the soft
 * signal glow. A password field gets 5b's "Show" toggle inside the box.
 */
export function Field({
  label,
  className,
  type,
  ...props
}: { label: string } & InputHTMLAttributes<HTMLInputElement>) {
  const [revealed, setRevealed] = useState(false);
  const isPassword = type === 'password';
  return (
    <label className="flex flex-col">
      <span className="text-[10.5px] font-bold tracking-[0.1em] text-faint uppercase">{label}</span>
      <span
        className={cn(
          'mt-2 flex h-14 items-center gap-3 rounded-2xl border border-hairline bg-surface px-[15px]',
          'focus-within:border-[1.5px] focus-within:border-signal focus-within:px-[14.5px] focus-within:shadow-[0_0_0_4px_rgba(45,85,245,0.08)]'
        )}
      >
        <input
          type={isPassword && revealed ? 'text' : type}
          className={cn('min-w-0 flex-1 border-0 bg-transparent p-0 text-[16px] font-semibold text-ink placeholder:font-normal placeholder:text-disabled-ink focus:outline-none', className)}
          {...props}
        />
        {isPassword && (
          <button type="button" onClick={() => setRevealed((r) => !r)} className="shrink-0 text-[12.5px] font-bold text-signal">
            {revealed ? 'Hide' : 'Show'}
          </button>
        )}
      </span>
    </label>
  );
}
