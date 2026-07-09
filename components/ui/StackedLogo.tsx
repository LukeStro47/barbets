import Image from 'next/image';
import { cn } from '@/lib/cn';

/** Coin over wordmark, stacked vertically — for a big centered hero mark (landing page), as opposed to <Logo />'s horizontal nav lockup. */
export function StackedLogo({ height = 140, className }: { height?: number; className?: string }) {
  const width = Math.round(height * (1527 / 1911));
  return (
    <Image
      src="/barbets-stacked.png"
      alt="Barbets"
      width={width}
      height={height}
      priority
      className={cn('mx-auto', className)}
      style={{ height, width: 'auto' }}
    />
  );
}
