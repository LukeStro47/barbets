/** The fixed set of symbols an owner can pick for a custom award, replacing a free-typed emoji
 * (see the icon_key rename migration for why). Same 24x24 grid, stroke-width 1.9 convention as
 * AwardGlyph, so a custom award's icon reads as the same kind of mark as the fixed 8 titles'. */
export const CUSTOM_AWARD_ICONS = [
  { key: 'star', label: 'Star', path: 'M12 3 14.4 9.1 21 9.6 16 13.9 17.6 20.4 12 16.8 6.4 20.4 8 13.9 3 9.6 9.6 9.1Z' },
  {
    key: 'heart',
    label: 'Heart',
    path: 'M12 21s-6.7-4.35-9.4-8.5C.8 9.6 1.5 6 4.5 6c1.9 0 3.2 1 4.5 2.5C10.3 7 11.6 6 13.5 6c3 0 3.7 3.6 1.9 6.5C18.7 16.65 12 21 12 21Z',
  },
  { key: 'bolt', label: 'Bolt', path: 'M13 2 4 14h6l-1 8 9-12h-6l1-8Z' },
  { key: 'diamond', label: 'Diamond', path: 'M12 2 22 12 12 22 2 12Z' },
  { key: 'crown', label: 'Crown', path: 'M4 18h16l1-10-5 4-4-7-4 7-5-4Z' },
  {
    key: 'target',
    label: 'Target',
    path: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z',
  },
  { key: 'moon', label: 'Moon', path: 'M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5Z' },
  {
    key: 'trophy',
    label: 'Trophy',
    path: 'M8 3h8v6a4 4 0 0 1-8 0V3ZM8 5H5a3 3 0 0 0 3 3M16 5h3a3 3 0 0 1-3 3M9 21h6M12 15v6',
  },
] as const;

export type CustomAwardIconKey = (typeof CUSTOM_AWARD_ICONS)[number]['key'];

export function customAwardIconPath(key: string): string {
  return CUSTOM_AWARD_ICONS.find((i) => i.key === key)?.path ?? CUSTOM_AWARD_ICONS[0].path;
}
