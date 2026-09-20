import type { InputHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

/**
 * Text field used by pre-group forms (sign in, sign up, forgot/reset password).
 * Label sits above the input but comes after it in the DOM (`flex-col-reverse`) so
 * focus can thicken the rule via `peer-focus:` without a client isFocused flag.
 */
export function Field({
  label,
  className,
  ...props
}: { label: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="flex flex-col-reverse gap-2">
      <input
        className={cn(
          'peer w-full rounded-[14px] border border-hairline bg-surface px-4 py-3.5 text-[15px] text-ink',
          'placeholder:text-faint focus:border-signal focus:outline-none focus:ring-4 focus:ring-signal/15',
          className
        )}
        {...props}
      />
      <span className="text-[11.5px] font-bold tracking-[0.1em] text-faint uppercase peer-focus:text-signal">
        {label}
      </span>
    </label>
  );
}
