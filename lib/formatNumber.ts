/** Thousands-separated token amount for display — e.g. 2450 -> "2,450". */
export function formatTokens(n: number): string {
  return n.toLocaleString('en-US');
}
