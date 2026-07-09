export type SeasonLength = '1m' | '2m' | '3m' | 'manual';

export function formatSeasonLength(len: SeasonLength): string {
  if (len === 'manual') return 'Manual (owner ends it)';
  const n = len[0];
  return `${n} month${n === '1' ? '' : 's'}`;
}
