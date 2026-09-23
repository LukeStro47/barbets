import type { ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

type Variant = 'primary' | 'secondary' | 'dark' | 'outline' | 'ghost' | 'danger' | 'muted' | 'accent';
type Size = 'sm' | 'md' | 'lg' | 'xl';

const variantClasses: Record<Variant, string> = {
  primary:
    'bg-signal text-white shadow-[var(--elevation-cta)] hover:bg-signal-deep disabled:bg-disabled-bg disabled:text-disabled-ink disabled:shadow-none',
  /** Alias kept for call sites that used the old honey accent CTA. */
  accent:
    'bg-signal text-white shadow-[var(--elevation-cta)] hover:bg-signal-deep disabled:bg-disabled-bg disabled:text-disabled-ink disabled:shadow-none',
  secondary: 'bg-surface border border-hairline text-ink hover:bg-rule disabled:text-disabled-ink',
  dark: 'bg-ink text-white hover:bg-ink/90 disabled:bg-disabled-bg disabled:text-disabled-ink',
  outline: 'border border-hairline bg-surface text-ink hover:bg-rule disabled:text-disabled-ink',
  ghost: 'text-muted hover:bg-rule disabled:text-disabled-ink',
  danger: 'bg-alert text-white hover:bg-alert/90 disabled:bg-alert-bg disabled:text-disabled-ink',
  /** Looks disabled while staying clickable, for controls that need to explain why they're off. */
  muted: 'bg-disabled-bg text-disabled-ink hover:bg-disabled-bg',
};

const sizeClasses: Record<Size, string> = {
  sm: 'px-3 py-1.5 text-[13px] font-bold rounded-[14px]',
  md: 'px-4 py-2.5 text-[15px] font-bold rounded-[14px]',
  lg: 'px-6 py-[15px] text-[15px] font-bold rounded-[14px]',
  /** Full-bleed screen CTA (splash, auth, invite). */
  xl: 'px-6 py-4 text-[15px] font-bold rounded-[14px]',
};

export function Button({
  variant = 'primary',
  size = 'md',
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size }) {
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center whitespace-nowrap transition-colors duration-150 ease-out disabled:cursor-not-allowed',
        variantClasses[variant],
        sizeClasses[size],
        className
      )}
      {...props}
    />
  );
}
