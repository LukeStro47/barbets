export type SeasonLength = '1m' | '2m' | '3m' | 'manual' | 'custom';

export function formatSeasonLength(len: SeasonLength): string {
  if (len === 'manual') return 'Manual (owner ends it)';
  if (len === 'custom') return 'Custom end date';
  const n = len[0];
  return `${n} month${n === '1' ? '' : 's'}`;
}

/** Shown as a hint under the length picker so people don't have to guess how to fit an event into month-scale presets. */
export const SEASON_LENGTH_HINTS: Record<SeasonLength, string> = {
  '1m': 'A short, regularly-refreshing run.',
  '2m': 'A couple months of play between resets.',
  '3m': 'Long enough to feel like a real summer or semester.',
  manual: 'Runs until you end it yourself, no clock.',
  custom: 'Pick the exact day and time it ends, good for a single weekend, a summer with a specific end, or a one-night event.',
};
