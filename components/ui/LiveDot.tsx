import { cn } from '@/lib/cn';

/** 5i's inline "this is live" marker: a 7px signal-blue circle breathing on `bb-fade`
 * (globals.css) — a smaller, plainer sibling to the boot splash's caption fade. Previously
 * specified but never actually placed anywhere; used next to an open market's status now. */
export function LiveDot({ className }: { className?: string }) {
  return <span aria-hidden className={cn('inline-block h-[7px] w-[7px] animate-bb-fade rounded-full bg-signal', className)} />;
}
