import type { InputHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

/**
 * The underlined text field used by every pre-group form (sign in, sign up, forgot password,
 * reset password). Replaces the boxed `inputClasses` string that used to be copy-pasted into
 * AuthForms, ForgotPasswordForm and JoinFlow independently.
 *
 * The label sits above the input but comes *after* it in the DOM (`flex-col-reverse`), which is
 * what lets it react to focus with a plain `peer-focus:` variant instead of making this a client
 * component just to hold an isFocused boolean. The focus state thickens the rule from 1px to 2px
 * and takes a matching 1px off the bottom padding, so nothing below the field shifts.
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
          'peer w-full border-b border-espresso-200 bg-transparent px-0.5 pt-1.5 pb-3 text-lg text-espresso-900',
          'placeholder:text-espresso-500 focus:border-b-2 focus:border-honey-500 focus:pb-[11px] focus:outline-none',
          className
        )}
        {...props}
      />
      <span className="text-xs font-bold tracking-[1.4px] text-espresso-400 uppercase peer-focus:text-honey-700">
        {label}
      </span>
    </label>
  );
}
