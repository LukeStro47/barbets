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

/** One-line explanation, used on the create-market sheet's type picker. */
export const MARKET_TYPE_DESCRIPTION: Record<MarketType, string> = {
  yes_no: 'Two sides. One question.',
  over_under: 'Over or under a line.',
  multiple_choice: 'Two to ten named options.',
};
