import { cn } from '@/lib/cn';

/** 5i's route-level loading language: a `bg-rule` block with a lighter sweep drifting across it
 * (globals.css's `bb-shimmer` keyframe, `currentcolor`-driven so the sweep's own brightness is
 * just `text-surface` here rather than a second background layered on top). Use for skeleton rows
 * while a page's real data is still loading — the boot splash and inline "Loading" captions stay
 * on `LoadingAnimation`'s two-bar settle motif; this is the other documented loading state,
 * previously specified in DESIGN.md/globals.css but never actually used anywhere. */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-bb-shimmer overflow-hidden rounded-[10px] bg-rule text-surface', className)} />;
}
