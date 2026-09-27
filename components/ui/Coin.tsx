import { BrandTile } from '@/components/ui/BrandMark';

/** The mark alone, no wordmark (3ac): the signal-blue "b" tile. Kept under its old name so
 *  existing hero placements pick up the new mark without churn. */
export function Coin({ size = 64, className }: { size?: number; className?: string }) {
  return <BrandTile size={size} className={className} />;
}
