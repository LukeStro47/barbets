/** Thousands-separated token amount for display — e.g. 2450 -> "2,450". */
export function formatTokens(n: number): string {
  return n.toLocaleString('en-US');
}

/** Round to 1 decimal, no trailing zero — for percentages computed client-side (e.g. 100 - x), where plain subtraction on an already-rounded float can print artifacts like 16.700000000000003. Math.round snaps to a clean integer before dividing back down, so the float garbage never survives to display. */
export function formatPercent(n: number): string {
  return (Math.round(n * 10) / 10).toString();
}
