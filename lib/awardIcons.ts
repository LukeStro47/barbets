/** The fixed set of symbols an owner can pick for an award's icon — shared by both the 4 default
 * titles (group_titles.icon_key) and custom awards (custom_group_titles.icon_key), so a picked
 * icon reads as the same kind of mark everywhere on the Awards page. Same 24x24 grid,
 * stroke-width 1.9 convention throughout; paths are chosen for a loose thematic fit, not a strict
 * 1:1 meaning. `target`, `snowflake`, `clock`, and `spike` are the 4 default titles' original
 * bespoke glyphs, folded in here so nothing changes visually for a group that never customizes. */
export const AWARD_ICONS = [
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
  { key: 'snowflake', label: 'Snowflake', path: 'M12 3v18M5 7l14 10M19 7 5 17' },
  { key: 'clock', label: 'Clock', path: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 7v5l3.5 2' },
  { key: 'spike', label: 'Spike', path: 'M4 12.5 8 16.5 14 8M12 16.5 14 18.5 20 10' },
  {
    key: 'flame',
    label: 'Flame',
    path: 'M12 2C9 5 6 9 6 13a6 6 0 0 0 12 0c0-4-3-8-6-11ZM12 9c-1.7 2-2.5 3.5-2.5 5.5a2.5 2.5 0 0 0 5 0C14.5 12.5 13.7 11 12 9Z',
  },
  { key: 'medal', label: 'Medal', path: 'M12 21a5 5 0 1 0 0-10 5 5 0 0 0 0 10ZM9 12 6 3M15 12 18 3' },
  { key: 'shield', label: 'Shield', path: 'M12 3 19 6v6c0 5-3 7.5-7 9-4-1.5-7-4-7-9V6Z' },
  {
    key: 'skull',
    label: 'Skull',
    path: 'M12 3a6.5 6.5 0 0 0-6.5 6.5c0 2.5 1.2 4 2.3 5.3L8 19h8l.2-4.2c1.1-1.3 2.3-2.8 2.3-5.3A6.5 6.5 0 0 0 12 3ZM9.5 10.5a1.2 1.2 0 1 0 0 2.4 1.2 1.2 0 0 0 0-2.4ZM14.5 10.5a1.2 1.2 0 1 0 0 2.4 1.2 1.2 0 0 0 0-2.4Z',
  },
  {
    key: 'rocket',
    label: 'Rocket',
    path: 'M12 2c2.5 2 3.5 5.5 3.5 8.5 0 2-.7 3.7-1 4.5H9.5c-.3-.8-1-2.5-1-4.5C8.5 7.5 9.5 4 12 2ZM9 14l-2.5 2.5v2.5l2.5-1M15 14l2.5 2.5v2.5l-2.5-1M12 8a1.3 1.3 0 1 0 0 2.6A1.3 1.3 0 0 0 12 8Z',
  },
] as const;

export type AwardIconKey = (typeof AWARD_ICONS)[number]['key'];

export function awardIconPath(key: string): string {
  return AWARD_ICONS.find((i) => i.key === key)?.path ?? AWARD_ICONS[0].path;
}
