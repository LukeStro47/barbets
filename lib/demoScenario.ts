/**
 * Fixed, fake data for the /demo walkthrough — a self-contained sandbox with
 * no Supabase reads/writes. The payout math is the real parimutuel formula
 * from `finalize_market` (see ARCHITECTURE.md), so the number the visitor
 * sees is genuinely computed, not a scripted value, even though the market
 * itself and the other bettors are all made up.
 */

export const DEMO_QUESTION = 'Will Jake finish the marathon in under 4 hours?';
export const DEMO_STARTING_BALANCE = 500;

export type DemoSide = 'yes' | 'no';

/** Fake pool already in the market before the visitor bets — reads as "12 bets placed". */
const SEED_POOL: Record<DemoSide, number> = { yes: 340, no: 260 };
export const SEED_BET_COUNT = 12;

/** A couple of fake bettors on each side, used to populate "who called it" once the visitor's side wins. */
const SEED_BETTORS: Record<DemoSide, { nickname: string; amount: number }[]> = {
  yes: [
    { nickname: 'sam', amount: 120 },
    { nickname: 'priya', amount: 65 },
  ],
  no: [
    { nickname: 'marcus', amount: 90 },
    { nickname: 'dee', amount: 55 },
  ],
};

export interface DemoOutcome {
  /** Odds split after the visitor's bet is folded into the seed pool, sorted yes-then-no. */
  yesPercent: number;
  noPercent: number;
  totalPool: number;
  /** The visitor's own payout, via the real floor(amount * total_pool / winning_pool) formula. */
  payout: number;
  callers: { nickname: string; amount: number; payout: number; isYou?: boolean }[];
}

/**
 * The demo always resolves to whichever side the visitor bet — the point is
 * to sell the mechanic (sealed odds -> reveal -> parimutuel payout) with a
 * guaranteed satisfying result, not to model realistic odds.
 */
export function resolveDemoBet(side: DemoSide, amount: number): DemoOutcome {
  const otherSide: DemoSide = side === 'yes' ? 'no' : 'yes';
  const winningPool = SEED_POOL[side] + amount;
  const losingPool = SEED_POOL[otherSide];
  const totalPool = winningPool + losingPool;

  const payoutFor = (stake: number) => Math.floor((stake * totalPool) / winningPool);

  const callers = [
    ...SEED_BETTORS[side].map((b) => ({ ...b, payout: payoutFor(b.amount) })),
    { nickname: 'You', amount, payout: payoutFor(amount), isYou: true },
  ].sort((a, b) => b.payout - a.payout);

  const yesPool = side === 'yes' ? winningPool : losingPool;
  const yesPercent = Math.round((yesPool / totalPool) * 100);

  return {
    yesPercent,
    noPercent: 100 - yesPercent,
    totalPool,
    payout: payoutFor(amount),
    callers,
  };
}
