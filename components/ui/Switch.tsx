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
}: {
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={onChange}
      className={cn(
        'relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors duration-200 ease-in-out disabled:cursor-not-allowed disabled:opacity-50',
        checked ? 'bg-honey-500' : 'bg-espresso-200',
        className
      )}
    >
      <span
        className={cn(
          'inline-block h-5 w-5 rounded-full bg-paper-white shadow-[0_1px_3px_rgba(28,19,13,0.35)] transition-transform duration-200 ease-in-out',
          checked ? 'translate-x-6' : 'translate-x-1'
        )}
      />
    </button>
  );
}
