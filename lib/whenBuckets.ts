/**
 * Preview of the four fixed options a `when` market opens with. The real labels are generated
 * by `_when_option_labels()` in Postgres at the moment `create_market()` runs (in the group's
 * timezone, `group_settings.timezone`), and stored as plain text on `market_options` so the
 * market stays self-describing after the words "tonight" and "this weekend" have stopped meaning
 * anything. This mirror exists only so the wizard can show the creator what those four rows will
 * say before they commit; it is never sent to the server. Keep the two in step.
 *
 * Rules (same as the SQL): the three dated windows always nest, tonight < this weekend < this
 * month. "This weekend" is the coming Sunday, or the one after if today already is Sunday. "This
 * month" is the last day of the current month, or of the next one when that would land on or
 * before the weekend bucket.
 */

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Today's calendar date in an IANA zone, as a UTC-midnight Date so day arithmetic below stays DST-proof. */
function localDateIn(now: Date, timeZone: string): Date {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(now);
  } catch {
    parts = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(now);
  }
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return new Date(Date.UTC(get('year'), get('month') - 1, get('day')));
}

const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);
/** Last day of the month `d` falls in (UTC fields, matching localDateIn). */
const monthEnd = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
/** Postgres `to_char(d, 'Dy Mon FMDD')`: "Wed Sep 9". */
const dayMonDD = (d: Date) => `${DAY_NAMES[d.getUTCDay()]} ${MONTH_NAMES[d.getUTCMonth()]} ${d.getUTCDate()}`;
const monDD = (d: Date) => `${MONTH_NAMES[d.getUTCMonth()]} ${d.getUTCDate()}`;

export function whenBucketLabels(now: Date, timeZone: string): [string, string, string, string] {
  const today = localDateIn(now, timeZone);

  // The coming Sunday, or the one after when today already is one. getUTCDay(): Sunday = 0.
  let weekend = addDays(today, (7 - today.getUTCDay()) % 7);
  if (weekend.getTime() <= today.getTime()) weekend = addDays(weekend, 7);

  let month = monthEnd(today);
  if (month.getTime() <= weekend.getTime()) month = monthEnd(addDays(month, 1));

  return [
    `Tonight (by end of ${dayMonDD(today)})`,
    `This weekend (by ${dayMonDD(weekend)})`,
    `This month (by ${dayMonDD(month)})`,
    `Never (not by ${monDD(month)})`,
  ];
}
