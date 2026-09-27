import { cn } from '@/lib/cn';

/**
 * 5i: "The loader, a book settling." Two stakes pushing against each other on one bar, the split
 * never quite resting — no spinner anywhere in the app, waiting always looks like a market finding
 * its price. Both halves run the same 2.4s curve (bb-settle/bb-settle-b in globals.css) so the
 * seam always moves together.
 *
 * Three sizes, per the spec card: `lg` full screen on ink (10px, blue against white), `sm` on
 * light (6px, blue against ink), `inline` a 26x4 sliver beside a label.
 */
export function SettleBar({ size = 'sm', dark = false, className }: { size?: 'lg' | 'sm' | 'inline'; dark?: boolean; className?: string }) {
  return (
    <div
      aria-hidden
      className={cn(
        'relative overflow-hidden rounded-full',
        size === 'lg' ? 'h-[10px] w-full' : size === 'sm' ? 'h-[6px] w-full' : 'h-1 w-[26px] shrink-0',
        dark ? 'bg-white/[0.13]' : size === 'lg' ? 'bg-rule' : 'bg-rule',
        className
      )}
    >
      <span className="absolute inset-0 origin-left animate-bb-settle bg-signal" />
      <span className={cn('absolute inset-0 origin-right animate-bb-settle-b', dark ? 'bg-surface' : 'bg-ink')} />
    </div>
  );
}

/** The bar plus its caption, for route loading states and the boot splash. `size="sm"` drops to
 *  the 6px light bar with no caption, for inside a card (5j). */
export function LoadingAnimation({ label = 'Loading', dark = false, size }: { label?: string; dark?: boolean; size?: 'sm' }) {
  if (size === 'sm') return <SettleBar size="sm" dark={dark} />;
  return (
    <div className="flex w-[220px] flex-col items-center gap-[18px]">
      <SettleBar size="lg" dark={dark} />
      <span className={cn('animate-bb-fade font-mono text-xs tracking-[0.06em]', dark ? 'text-[#a8b0bd]' : 'text-faint')}>{label}</span>
    </div>
  );
}
