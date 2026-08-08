import type { TitleKey } from '@/lib/titles';

/** One stroked path per title, purely decorative flair next to the label (which is always the
 * real information carrier) — chosen for a loose thematic fit, not a strict 1:1 meaning. Same
 * 24x24 grid, stroke-width 1.9 convention for any glyph added later. */
export const AWARD_GLYPH_PATHS: Record<TitleKey, string> = {
  oracle: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z',
  ice_cold: 'M12 3v18M5 7l14 10M19 7 5 17',
  bandwagon: 'M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1ZM12 8.5v7M8.5 12h7',
  cursed: 'M4 9h11M11 5l4 4-4 4M20 15H9M13 19l-4-4 4-4',
  on_fire: 'M4 16 9.5 10.5l3.5 3.5L20 7M15 7h5v5',
  degenerate: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 7v5l3.5 2',
  whale: 'M12 8.5c3.9 0 7-1.2 7-2.75S15.9 3 12 3 5 4.2 5 5.75 8.1 8.5 12 8.5ZM5 5.75v12.5C5 19.8 8.1 21 12 21s7-1.2 7-2.75V5.75M5 12c0 1.55 3.1 2.75 7 2.75s7-1.2 7-2.75',
  risk_taker: 'M4 12.5 8 16.5 14 8M12 16.5 14 18.5 20 10',
};

export function AwardGlyph({ titleKey, stroke, size = 21 }: { titleKey: TitleKey; stroke: string; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" style={{ height: size, width: size }}>
      <path d={AWARD_GLYPH_PATHS[titleKey]} />
    </svg>
  );
}
