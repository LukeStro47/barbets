import { customAwardIconPath } from '@/lib/customAwardIcons';

/** Shared with `CustomAwardsSection` (the awards page) and `MemberProfileCard` (a held custom
 * award listed on the member record) — one place rendering a custom award's chosen symbol. */
export function CustomAwardGlyph({ iconKey, stroke, size = 20 }: { iconKey: string; stroke: string; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" style={{ height: size, width: size }}>
      <path d={customAwardIconPath(iconKey)} />
    </svg>
  );
}
