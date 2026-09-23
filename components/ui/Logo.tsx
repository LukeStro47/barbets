import { cn } from '@/lib/cn';

/** Type wordmark: lowercase "barbets" in Plus Jakarta Sans 800. */
export function Logo({ className, height = 32 }: { className?: string; height?: number }) {
  const fontSize = Math.round(height * 0.72);
  return (
    <span
      className={cn('inline-flex items-center font-extrabold tracking-[-0.035em]', className ?? 'text-ink')}
      style={{ fontSize, lineHeight: 1 }}
    >
      barbets
    </span>
  );
}

/** Signal-blue rounded tile with a white lowercase "b" — the app mark. */
export function Mark({
  size = 40,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center justify-center rounded-[11px] bg-signal font-extrabold tracking-[-0.05em] text-white',
        className
      )}
      style={{ width: size, height: size, fontSize: size * 0.58, lineHeight: 1 }}
      aria-hidden
    >
      b
    </span>
  );
}
