/** Thousands-separated token amount for display — e.g. 2450 -> "2,450". */
export function formatTokens(n: number): string {
  return n.toLocaleString('en-US');
}

/** Live comma-formatter for a "token allocation" text input as the user types — strips
 * anything that isn't a digit, then re-inserts thousands commas (e.g. "10a5,00" -> "1,500").
 * Pass `max` to also clamp, which is what stops the field growing past the allocation cap the
 * same way `maxLength` stops a name field: the keystroke just doesn't land. The server check in
 * `update_group_settings`/`create_group` is still the real one.
 * Pair with `.replace(/,/g, '')` wherever the value is actually read/submitted. */
export function formatTokenInputValue(raw: string, max?: number): string {
  const digits = raw.replace(/\D/g, '');
  if (!digits) return '';
  const n = Number(digits);
  return (max !== undefined && n > max ? max : n).toLocaleString('en-US');
}

/** Signed token amount for a net-gain/loss display — "+240" / "−85" (a real minus sign, not
 * a bare negative number) so a group row's win/loss reads at a glance without also needing a
 * caret icon or color to carry the direction. Zero renders as "+0", same as any other gain. */
export function formatSignedTokens(n: number): string {
  return n < 0 ? `−${formatTokens(Math.abs(n))}` : `+${formatTokens(n)}`;
}

/** Round to 1 decimal, no trailing zero — for percentages computed client-side (e.g. 100 - x), where plain subtraction on an already-rounded float can print artifacts like 16.700000000000003. Math.round snaps to a clean integer before dividing back down, so the float garbage never survives to display. */
export function formatPercent(n: number): string {
  return (Math.round(n * 10) / 10).toString();
}

/** "1st"/"2nd"/"3rd"/"4th"... standard English ordinal suffix, including the 11th-13th exception. */
export function formatOrdinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}
