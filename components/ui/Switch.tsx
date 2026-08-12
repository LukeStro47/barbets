import { cn } from '@/lib/cn';

/**
 * Standard iOS-style pattern: the knob is always white with a drop shadow
 * (for a "lifted" look), only the track fill changes color. The previous
 * version changed the knob's own color and used a white/bordered off-track,
 * which nearly disappeared against the white cards it usually sits on.
 */
export function Switch({
  checked,
  onChange,
  disabled,
  className,
  size = 'md',
}: {
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
  className?: string;
  /** 'sm' is for switches nested under a master one (the notification categories inside a
   * group), where a full-size track would read as another top-level control. */
  size?: 'md' | 'sm';
}) {
  const small = size === 'sm';
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={onChange}
      className={cn(
        'relative inline-flex shrink-0 items-center rounded-full transition-colors duration-200 ease-in-out disabled:cursor-not-allowed disabled:opacity-50',
        small ? 'h-[22px] w-[38px]' : 'h-7 w-12',
        checked ? 'bg-honey-500' : 'bg-espresso-200',
        className
      )}
    >
      <span
        className={cn(
          'inline-block rounded-full bg-paper-white shadow-[0_1px_3px_rgba(28,19,13,0.35)] transition-transform duration-200 ease-in-out',
          small ? 'h-4 w-4' : 'h-5 w-5',
          small ? (checked ? 'translate-x-[19px]' : 'translate-x-[3px]') : checked ? 'translate-x-6' : 'translate-x-1'
        )}
      />
    </button>
  );
}
