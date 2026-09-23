import { cn } from '@/lib/cn';
import { Logo, Mark } from '@/components/ui/Logo';

/** Centred mark over wordmark for hero placements (cold open, entry). */
export function StackedLogo({ height = 140, className }: { height?: number; className?: string }) {
  const markSize = Math.round(height * 0.48);
  const wordHeight = Math.round(height * 0.28);
  return (
    <div className={cn('mx-auto flex flex-col items-center gap-3', className)} style={{ height }}>
      <Mark size={markSize} />
      <Logo height={wordHeight} />
    </div>
  );
}
