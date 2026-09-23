import { cn } from '@/lib/cn';

/** The "odds settling" loader used by BootSplash and every route loading.tsx: two overlapping
 *  bars pushing against each other, the split never quite resting — no spinner anywhere in the
 *  app, waiting always looks like a market finding its price (see globals.css's
 *  bb-settle/bb-settle-b/bb-fade keyframes, and DESIGN.md's loading spec). `dark` is for a full
 *  ink background (the splash); the default light variant is for anywhere else. */
export function LoadingAnimation({ label = 'Loading', dark = false }: { label?: string; dark?: boolean }) {
  return (
    <div className="flex w-[220px] flex-col items-center gap-[18px]">
      <div className={cn('relative h-[10px] w-full overflow-hidden rounded-full', dark ? 'bg-white/[0.13]' : 'bg-rule')}>
        <span aria-hidden className="absolute inset-0 origin-left animate-bb-settle bg-signal" />
        <span aria-hidden className={cn('absolute inset-0 origin-right animate-bb-settle-b', dark ? 'bg-white' : 'bg-ink')} />
      </div>
      <span className={cn('animate-bb-fade font-mono text-xs tracking-[0.06em]', dark ? 'text-white/70' : 'text-faint')}>{label}</span>
    </div>
  );
}
