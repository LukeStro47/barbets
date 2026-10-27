import type { ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

type Variant = 'primary' | 'accent' | 'outline' | 'ghost' | 'danger' | 'muted';
type Size = 'sm' | 'md' | 'lg' | 'xl';

const variantClasses: Record<Variant, string> = {
  /** DESIGN.md's "dark-button": solid ink fill, for a strong action that isn't the screen's one accent-colored CTA. */
  primary: 'bg-ink text-surface hover:opacity-90 disabled:bg-disabled-bg disabled:text-disabled-ink',
  /** DESIGN.md's "primary-button": the single signal-blue CTA, with the one shadow the system allows outside a sheet. */
  accent:
    'bg-signal text-surface shadow-[0_10px_20px_-10px_rgba(45,85,245,0.7)] hover:bg-signal-deep disabled:bg-disabled-bg disabled:text-disabled-ink disabled:shadow-none',
  outline: 'border border-hairline text-ink hover:bg-rule disabled:text-disabled-ink',
  ghost: 'text-muted hover:bg-rule disabled:text-disabled-ink',
  danger: 'bg-alert text-surface hover:opacity-90 disabled:bg-alert-bg disabled:text-disabled-ink',
  /** Looks disabled (greyed out) while staying clickable, for controls that need to explain why they're off rather than silently doing nothing. */
  muted: 'bg-disabled-bg text-disabled-ink hover:bg-disabled-bg',
};

/** Font weight lives here rather than in the shared base, so `xl` can be heavier without two
 *  conflicting `font-*` utilities landing on the same element (cn() is a plain join, not a merge).
 *  Radius is 14px everywhere per DESIGN.md's button role — chips/pills stay fully round, buttons don't. */
const sizeClasses: Record<Size, string> = {
  sm: 'px-3 py-1.5 text-sm font-semibold rounded-[14px]',
  md: 'px-4 py-2.5 text-sm font-semibold rounded-[14px]',
  lg: 'px-6 py-3 text-base font-semibold rounded-[14px]',
  /** The one CTA on a full-bleed screen (splash, auth, invite, 404, offline). */
  xl: 'px-6 py-4 text-[17px] font-bold rounded-[14px]',
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
        'whitespace-nowrap transition-colors disabled:cursor-not-allowed',
        variantClasses[variant],
        sizeClasses[size],
        className
      )}
      {...props}
    />
  );
}
