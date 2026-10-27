/**
 * A member's standing by balance, tie-aware. Equal balances share a rank (two people level on top
 * are both 1st, the next is 3rd), and when everyone is still level nobody has a standing at all,
 * so `rank` is null. Ranking by list position instead gave a brand-new group, where everyone sits
 * on the same seed, an arbitrary "3rd of 3" before a single bet was placed.
 *
 * Pure, so the group hub, the groups list and the leaderboard can share it from server or client.
 */
export function standingOf(
  rows: { user_id: string; balance: number }[],
  userId: string
): { rank: number | null; of: number } {
  const of = rows.length;
  const mine = rows.find((r) => r.user_id === userId);
  if (!mine) return { rank: null, of };
  const allLevel = rows.every((r) => r.balance === rows[0].balance);
  if (allLevel) return { rank: null, of };
  return { rank: rows.filter((r) => r.balance > mine.balance).length + 1, of };
}
