import { BrandTile, Wordmark } from '@/components/ui/BrandMark';
import { cn } from '@/lib/cn';

/** The stacked lock-up (6a): tile over wordmark, for square/centred hero placements. `height` is
 *  the overall height; the tile takes a bit under half of it. */
export function StackedLogo({ height = 140, className }: { height?: number; className?: string }) {
  const tile = Math.round(height * 0.46);
  return (
    <span className={cn('mx-auto inline-flex flex-col items-center gap-[9px]', className)} aria-label="barbets">
      <BrandTile size={tile} />
      <Wordmark size={Math.round(tile * 0.43)} />
    </span>
  );
}
