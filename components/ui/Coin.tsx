import Image from 'next/image';
import { cn } from '@/lib/cn';

/** The coin emblem alone, no wordmark — for centered hero placements (auth pages, invite confirmation) where <Logo />'s horizontal lockup would be too wide. */
export function Coin({ size = 64, className }: { size?: number; className?: string }) {
  return <Image src="/barbets-coin.png" alt="" width={size} height={size} priority className={cn('shrink-0', className)} />;
}
