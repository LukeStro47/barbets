import type { ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

type Variant = 'primary' | 'accent' | 'outline' | 'ghost' | 'danger' | 'muted';
type Size = 'sm' | 'md' | 'lg' | 'xl';

const variantClasses: Record<Variant, string> = {
  primary: 'bg-espresso-800 text-paper-white hover:bg-espresso-900 disabled:bg-espresso-300',
  accent: 'bg-honey-500 text-espresso-900 hover:bg-honey-600 disabled:bg-honey-200',
  outline: 'border border-espresso-200 text-espresso-800 hover:bg-espresso-50 disabled:text-espresso-300',
  ghost: 'text-espresso-700 hover:bg-espresso-50 disabled:text-espresso-300',
  danger: 'bg-danger-500 text-paper-white hover:bg-danger-700 disabled:bg-danger-100',
  /** Looks disabled (greyed out) while staying clickable, for controls that need to explain why they're off rather than silently doing nothing. */
  muted: 'bg-espresso-100 text-espresso-400 hover:bg-espresso-100',
};

/** Font weight lives here rather than in the shared base, so `xl` can be heavier without two
 *  conflicting `font-*` utilities landing on the same element (cn() is a plain join, not a merge). */
const sizeClasses: Record<Size, string> = {
  sm: 'px-3 py-1.5 text-sm font-semibold rounded-full',
  md: 'px-4 py-2.5 text-sm font-semibold rounded-full',
  lg: 'px-6 py-3 text-base font-semibold rounded-full',
  /** The one CTA on a full-bleed screen (splash, auth, invite, 404, offline). */
  xl: 'px-6 py-4 text-[17px] font-bold rounded-full',
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
