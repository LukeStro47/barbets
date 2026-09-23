import type { InputHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

/**
 * The bordered field used by every pre-group form (sign in, sign up, forgot password, reset
 * password, join-with-code). Structurally different from the field this replaced: that one was
 * underlined with a floating label reacting to focus via `peer-focus:`; the Ledger designs (5b,
 * 5c, 5f, 5l...) show a bordered 14px-radius box with the label as a plain uppercase caption
 * above it, so the label no longer needs to be a focus-reactive peer at all.
 *
 * Border goes from 1px hairline to 2px signal blue plus a soft glow on focus; padding shifts by
 * 1px in step so nothing below the field moves.
 */
export function Field({
  label,
  className,
  ...props
}: { label: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="flex flex-col gap-2">
      <span className="text-[10.5px] font-bold tracking-[1.4px] text-faint uppercase">{label}</span>
      <input
        className={cn(
          'w-full rounded-[14px] border border-hairline bg-surface px-4 py-3.5 text-lg text-ink',
          'placeholder:text-faint focus:border-2 focus:border-signal focus:px-[15px] focus:py-[13px]',
          'focus:shadow-[0_0_0_4px_rgba(45,85,245,0.08)] focus:outline-none',
          className
        )}
        {...props}
      />
    </label>
  );
}
