/**
 * One line per person per pick. Someone who bet 100 and then 150 on the same side placed two bets
 * rows, but they made one bet as far as anyone reading a result cares: 250 on that side, and the
 * two payouts added together. A hedge (bets on different sides or options) stays as separate
 * lines, since those really are different positions.
 *
 * Display only. The settlement arithmetic (SettlementLedger's computeSettlement, and its rounding
 * "dust" explanation) keeps working from the individual bets, because each bet's payout is
 * floored on its own and summing first would give a different number.
 */
export function combineBets<T extends { nickname: string; choiceLabel: string; amount: number; payout: number | null }>(bets: T[]): T[] {
  const byKey = new Map<string, T>();
  for (const b of bets) {
    const key = `${b.nickname}\u0000${b.choiceLabel}`;
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, { ...b });
    } else {
      byKey.set(key, {
        ...prev,
        amount: prev.amount + b.amount,
        payout: prev.payout == null && b.payout == null ? null : (prev.payout ?? 0) + (b.payout ?? 0),
      });
    }
  }
  return [...byKey.values()];
}

/** The combined line a single bet belongs to, for anything computed per bet (the dust holder). */
export function sameLine(a: { nickname: string; choiceLabel: string }, b: { nickname: string; choiceLabel: string }): boolean {
  return a.nickname === b.nickname && a.choiceLabel === b.choiceLabel;
}
