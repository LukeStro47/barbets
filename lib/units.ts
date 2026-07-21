/** Common over/under units shown as one-tap presets; anything else goes through the "custom" free-text field. */
export const OVER_UNDER_UNIT_PRESETS = ['$', 'min', 'hr', 'pts', '%'] as const;

/** Long-pressing the `$` preset reveals these as extra one-tap options, instead of cluttering the default row with every currency up front. */
export const OVER_UNDER_CURRENCY_ALTERNATES = ['£', '€'] as const;

export const OVER_UNDER_UNIT_MAX_LENGTH = 12;

/** A custom unit typed inline next to the line input beyond this length wraps to its own full-width row instead — it stops comfortably fitting the compact inline box. */
export const OVER_UNDER_UNIT_INLINE_MAX_LENGTH = 6;

/** Currency symbols prefix the number (`$5.5`, `£5.5`, `€5.5`); every other unit trails it (`5.5 min`). */
const PREFIXED_UNITS = new Set(['$', '£', '€']);

/** Returns the bare line when there's no unit. */
export function formatLine(line: number | string | null | undefined, unit?: string | null): string {
  if (line === null || line === undefined) return '';
  return unit ? (PREFIXED_UNITS.has(unit) ? `${unit}${line}` : `${line} ${unit}`) : String(line);
}
