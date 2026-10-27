import { cn } from '@/lib/cn';

/**
 * The 3ac mark: the logo is type, not artwork. The icon is a single lowercase "b" in Plus
 * Jakarta 800 at -0.05em, white on signal blue, in a tile rounded to ~22-30% of its width
 * depending on size (the design's own ladder: 22px tile/7px radius, 38/11, 64/15, 96/22). The
 * wordmark is the word "barbets" in the same weight at -0.035em. No image file is involved, so
 * there is nothing to redraw or crop — see `Brand & App Store.dc.html` 6a-6c for the misuse rules
 * (never a circle, never a capital, never tracked apart, never another tile colour).
 */
export function BrandTile({ size = 38, className }: { size?: number; className?: string }) {
  // Radius and glyph size follow the design's own ladder rather than one fixed ratio: small tiles
  // round proportionally more (7/22 ≈ 32%) than large ones (22/96 ≈ 23%).
  const radius = Math.round(size <= 24 ? size * 0.32 : size <= 40 ? size * 0.29 : size * 0.23);
  const glyph = Math.round(size * 0.58);
  return (
    <span
      aria-hidden
      className={cn('inline-flex shrink-0 items-center justify-center bg-signal', className)}
      style={{ height: size, width: size, borderRadius: radius }}
    >
      {/* Optical centre sits ~1px above the geometric one at icon sizes (6b). */}
      <span
        className="font-extrabold tracking-[-0.05em] text-surface"
        style={{ fontSize: glyph, lineHeight: 1, marginTop: size >= 60 ? -Math.round(size * 0.04) : -1 }}
      >
        b
      </span>
    </span>
  );
}

export function Wordmark({ size = 25, className }: { size?: number; className?: string }) {
  return (
    <span
      className={cn('font-extrabold tracking-[-0.035em] text-ink', className)}
      style={{ fontSize: size, lineHeight: 1.1 }}
    >
      barbets
    </span>
  );
}

/** Horizontal lock-up: tile + wordmark. The default placement (6a). */
export function BrandLockup({
  tile = 22,
  word = 16,
  className,
  wordClassName,
}: {
  tile?: number;
  word?: number;
  className?: string;
  wordClassName?: string;
}) {
  return (
    <span className={cn('inline-flex items-center gap-[9px]', className)} aria-label="barbets">
      <BrandTile size={tile} />
      <Wordmark size={word} className={wordClassName} />
    </span>
  );
}
