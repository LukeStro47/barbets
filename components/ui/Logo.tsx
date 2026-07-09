import Image from 'next/image';
import { cn } from '@/lib/cn';

/** The horizontal coin + wordmark lockup — for persistent nav/header placements, not centered hero art (use <Coin /> for those). */
export function Logo({ className, height = 32 }: { className?: string; height?: number }) {
  const width = Math.round(height * (3704 / 1700));
  return (
    <span className={cn('inline-flex items-center', className)}>
      <Image
        src="/barbets-lockup.png"
        alt="Barbets"
        width={width}
        height={height}
        priority
        className="block"
        style={{ height, width: 'auto' }}
      />
    </span>
  );
}
