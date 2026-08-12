export type SeasonLength = '1m' | '2m' | '3m' | 'manual' | 'custom';

export function formatSeasonLength(len: SeasonLength): string {
  if (len === 'manual') return 'Manual (owner ends it)';
  if (len === 'custom') return 'Custom end date';
  const n = len[0];
  return `${n} month${n === '1' ? '' : 's'}`;
}

/** The label-only form used by the create-group picker, where every option is a row in one list
 * and the explanation only appears once a length is chosen. `formatSeasonLength` above stays the
 * form used where a length is reported back rather than picked (group settings' summary line). */
export const SEASON_LENGTH_SHORT_LABEL: Record<SeasonLength, string> = {
  '1m': '1 month',
  '2m': '2 months',
  '3m': '3 months',
  manual: 'I end it',
  custom: 'A date',
};

/** Shown as a hint under the length picker so people don't have to guess how to fit an event into month-scale presets — each one names a concrete example of a group it'd suit, not just its duration. */
export const SEASON_LENGTH_HINTS: Record<SeasonLength, string> = {
  '1m': 'A short, regularly-refreshing run. Good for a fast-moving group that wants frequent fresh starts, like a monthly pickup league.',
  '2m': 'A couple months of play between resets. Suits an ongoing fantasy-style group without waiting too long for standings to matter.',
  '3m': 'Long enough to feel like a real summer or semester. Works well for something tied to a real season, like a sports league or a school term.',
  manual: 'Runs until you end it yourself, no clock. Good for a laid-back group that doesn\'t want a deadline hanging over it.',
  custom: 'Pick the exact day and time it ends, good for a single weekend, a summer with a specific end, or a one-night event.',
};
