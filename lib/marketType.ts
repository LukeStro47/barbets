export type MarketType = 'yes_no' | 'over_under' | 'multiple_choice' | 'most_likely_to' | 'when';

/** Every type, in the order the create sheet offers them. */
export const MARKET_TYPES: MarketType[] = ['yes_no', 'over_under', 'multiple_choice', 'most_likely_to', 'when'];

/** The types that settle on a `market_options` row (`bets.option_id`, `outcome_option_id`, ...)
 * rather than a `bet_side`. `most_likely_to` and `when` are `multiple_choice` underneath, differing
 * only in how their options come to exist (picked off the roster / fixed time buckets), so every
 * bet-slip, odds, ticket, reveal, and resolution surface treats the three identically. Mirrors
 * `_is_option_market()` in Postgres; the two must agree. */
export const OPTION_BASED_TYPES: readonly MarketType[] = ['multiple_choice', 'most_likely_to', 'when'];

export function isOptionBased(type: MarketType | string): boolean {
  return (OPTION_BASED_TYPES as readonly string[]).includes(type);
}

export const MARKET_TYPE_LABEL: Record<MarketType, string> = {
  yes_no: 'Yes / No',
  over_under: 'Over / Under',
  multiple_choice: 'Options',
  most_likely_to: 'Most likely to',
  when: 'When',
};

/** Short glyph, not an emoji face — these sit next to a status pill on every market row/card, so they need to read at a glance without competing for attention the way a colorful emoji would. */
export const MARKET_TYPE_ICON: Record<MarketType, string> = {
  yes_no: '◐',
  over_under: '⇅',
  multiple_choice: '☰',
  most_likely_to: '★',
  when: '◷',
};

/** One-line explanation, used on the create-market page's type picker — the one place this is a decision being made, not just a label on something that already exists. */
export const MARKET_TYPE_DESCRIPTION: Record<MarketType, string> = {
  yes_no: 'A straightforward two-sided question.',
  over_under: 'Bet against a number: over or under a line.',
  multiple_choice: '2 to 10 named options, one shared pool.',
  most_likely_to: 'Pick 2 to 10 members. Bet on who it will be.',
  when: 'Tonight, this weekend, this month, or never.',
};

/** The "what kind of choice is this" meta an option-based market shows on its ticket band, its
 * proposal modal, and the review step: "One of 4 options" / "One of 4 members" / "One of 4 time
 * windows". Callers handle yes_no/over_under themselves, since those carry a line. */
export function optionKindLabel(type: MarketType | string, optionCount: number): string {
  if (type === 'most_likely_to') return `One of ${optionCount} members`;
  if (type === 'when') return `One of ${optionCount} time windows`;
  return `One of ${optionCount} options`;
}

/** The fewest non-subject members a most_likely_to market should leave to bet on it before the
 * wizard warns. Soft: the server's own hard cap is the subject cap (member_count - 2) that every
 * market type shares. The creator and the endorser both count as eligible bettors, since both can
 * bet on a market they made or endorsed. */
export const MOST_LIKELY_TO_MIN_BETTORS = 3;
