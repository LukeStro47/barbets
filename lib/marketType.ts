export type MarketType = 'yes_no' | 'over_under' | 'multiple_choice';

export const MARKET_TYPE_LABEL: Record<MarketType, string> = {
  yes_no: 'Yes / No',
  over_under: 'Over / Under',
  multiple_choice: 'Options',
};

/** Short glyph, not an emoji face — these sit next to a status pill on every market row/card, so they need to read at a glance without competing for attention the way a colorful emoji would. */
export const MARKET_TYPE_ICON: Record<MarketType, string> = {
  yes_no: '◐',
  over_under: '⇅',
  multiple_choice: '☰',
};

/** One-line explanation, used on the create-market page's type picker — the one place this is a decision being made, not just a label on something that already exists. */
export const MARKET_TYPE_DESCRIPTION: Record<MarketType, string> = {
  yes_no: 'A straightforward two-sided question.',
  over_under: 'Bet against a number: over or under a line.',
  multiple_choice: '2 to 10 named options, one shared pool.',
};
