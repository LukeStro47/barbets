import { BrandLockup } from '@/components/ui/BrandMark';

/** The horizontal lock-up (3ac/6a): the "b" tile beside the wordmark. For persistent header
 *  placements; `height` is the tile's height, the wordmark scales with it. */
export function Logo({ className, height = 32 }: { className?: string; height?: number }) {
  return <BrandLockup tile={height} word={Math.round(height * 0.66)} className={className} />;
}
