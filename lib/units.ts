/** Common over/under units shown as one-tap presets; anything else goes through the "custom" free-text field. */
export const OVER_UNDER_UNIT_PRESETS = ['$', 'min', 'hr', 'pts', '%'] as const;

/** Long-pressing the `$` preset reveals these as extra one-tap options, instead of cluttering the default row with every currency up front. */
export const OVER_UNDER_CURRENCY_ALTERNATES = ['£', '€'] as const;

export const OVER_UNDER_UNIT_MAX_LENGTH = 10;

/** A custom unit typed inline next to the line input beyond this length wraps to its own full-width row instead — it stops comfortably fitting the compact inline box. */
export const OVER_UNDER_UNIT_INLINE_MAX_LENGTH = 6;

/** Currency symbols prefix the number (`$5.5`, `£5.5`, `€5.5`); every other unit trails it (`5.5 min`). */
const PREFIXED_UNITS = new Set(['$', '£', '€']);

/** How an over/under line is entered and stored. A number is the ordinary case (a free-text/preset
    `unit` can still trail or prefix it); 'date'/'time' repurpose `markets.unit` itself as the format
    marker instead of a display suffix — mutually exclusive with a real unit, since a line can't be
    both "a date" and "5.5 min" at once. No schema change: `unit` already accepts arbitrary text up
    to 10 characters for any over_under market, so these are just two more values it can hold. */
export type LineFormat = 'number' | 'date' | 'time';

export function isLineFormatUnit(unit: string | null | undefined): unit is 'date' | 'time' {
  return unit === 'date' || unit === 'time';
}

/** The line input's raw native value ("2027-03-05" for `<input type="date">`, "14:30" for
    `<input type="time">`, or a plain numeric string) to the number actually stored as `markets.line`.
    Dates are stored as whole-day Unix epoch seconds at UTC midnight (unambiguous, no timezone math
    needed since only the calendar date is ever compared); times are minutes since midnight (0-1439). */
export function parseLineInput(raw: string, format: LineFormat): number {
  if (format === 'date') return Math.floor(new Date(`${raw}T00:00:00Z`).getTime() / 1000);
  if (format === 'time') {
    const [h, m] = raw.split(':').map(Number);
    return h * 60 + m;
  }
  return Number(raw);
}

/** Returns the bare line when there's no unit. */
export function formatLine(line: number | string | null | undefined, unit?: string | null): string {
  if (line === null || line === undefined || line === '') return '';
  const n = Number(line);
  if (unit === 'date') {
    return new Date(n * 1000).toLocaleDateString(undefined, { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' });
  }
  if (unit === 'time') {
    const h = Math.floor(n / 60);
    const m = n % 60;
    const period = h < 12 ? 'AM' : 'PM';
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `${h12}:${String(m).padStart(2, '0')} ${period}`;
  }
  return unit ? (PREFIXED_UNITS.has(unit) ? `${unit}${line}` : `${line} ${unit}`) : String(line);
}
