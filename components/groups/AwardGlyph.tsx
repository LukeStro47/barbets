import { awardIconPath } from '@/lib/awardIcons';

/** Renders an award's chosen symbol — shared by the 4 default titles and custom awards alike,
 * since both now pick from the same icon set (lib/awardIcons.ts). */
export function AwardGlyph({ iconKey, stroke, size = 21 }: { iconKey: string; stroke: string; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" style={{ height: size, width: size }}>
      <path d={awardIconPath(iconKey)} />
    </svg>
  );
}
