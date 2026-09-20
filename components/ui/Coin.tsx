import { cn } from '@/lib/cn';
import { Mark } from '@/components/ui/Logo';

/** App mark alone — centered hero placements (auth pages, invite confirmation). */
export function Coin({ size = 64, className }: { size?: number; className?: string }) {
  return <Mark size={size} className={cn('shrink-0', className)} />;
}
