export type CustomTitleMetric =
  | 'win_rate'
  | 'bet_count'
  | 'tokens_wagered'
  | 'payout_multiple'
  | 'biggest_win'
  | 'biggest_loss'
  | 'net'
  | 'avg_bet_size'
  | 'distinct_markets_played'
  | 'markets_created'
  | 'resolutions_proposed'
  | 'challenges_raised'
  | 'votes_cast'
  | 'reactions_given'
  | 'times_subject';

export type CustomTitleDirection = 'asc' | 'desc';

export interface CustomAwardShape {
  /** Stable id for this named menu option, e.g. 'win_rate_desc' — not the same as the owner-chosen
      award name/emoji, which are free text collected separately. */
  key: string;
  metric: CustomTitleMetric;
  direction: CustomTitleDirection;
  /** The menu option's own display text (what it measures), shown when picking a shape. */
  menuLabel: string;
  description: string;
  format: (value: number | null) => string;
}

const tokens = (v: number) => Math.round(v).toLocaleString();

/**
 * The full shape menu, 18 named options over 15 metrics — three metrics (win_rate, net,
 * avg_bet_size) offer both directions since "the worst at this too" is genuinely a different, fun
 * fact; everything else only makes sense one way ("most" bets/votes/challenges, "biggest" single
 * win/loss). Deliberately excludes streak-based and "matches the market favorite" shapes — see the
 * migration's comment for why those don't parameterize into this pattern.
 */
export const CUSTOM_AWARD_SHAPES: CustomAwardShape[] = [
  {
    key: 'win_rate_desc',
    metric: 'win_rate',
    direction: 'desc',
    menuLabel: 'Highest win rate',
    description: 'Highest win rate in the group (min. 5 settled bets).',
    format: (v) => (v == null ? '' : `${Math.round(v * 100)}% win rate`),
  },
  {
    key: 'win_rate_asc',
    metric: 'win_rate',
    direction: 'asc',
    menuLabel: 'Lowest win rate',
    description: 'Lowest win rate in the group (min. 5 settled bets).',
    format: (v) => (v == null ? '' : `${Math.round(v * 100)}% win rate`),
  },
  {
    key: 'bet_count_desc',
    metric: 'bet_count',
    direction: 'desc',
    menuLabel: 'Most bets placed',
    description: 'Placed the most bets, ever.',
    format: (v) => (v == null ? '' : `${Math.round(v)} bets placed`),
  },
  {
    key: 'tokens_wagered_desc',
    metric: 'tokens_wagered',
    direction: 'desc',
    menuLabel: 'Most tokens wagered',
    description: 'Wagered the most tokens, ever.',
    format: (v) => (v == null ? '' : `${tokens(v)} wagered`),
  },
  {
    key: 'payout_multiple_desc',
    metric: 'payout_multiple',
    direction: 'desc',
    menuLabel: 'Best single payout multiple',
    description: 'The single biggest underdog win in the group, by payout multiple.',
    format: (v) => (v == null ? '' : `${v.toFixed(1)}x payout`),
  },
  {
    key: 'biggest_win_desc',
    metric: 'biggest_win',
    direction: 'desc',
    menuLabel: 'Biggest single win',
    description: 'The single biggest win in the group, by raw tokens.',
    format: (v) => (v == null ? '' : `+${tokens(v)} in one bet`),
  },
  {
    key: 'biggest_loss_desc',
    metric: 'biggest_loss',
    direction: 'desc',
    menuLabel: 'Biggest single loss',
    description: 'The single biggest loss in the group, by raw tokens.',
    format: (v) => (v == null ? '' : `−${tokens(v)} in one bet`),
  },
  {
    key: 'net_desc',
    metric: 'net',
    direction: 'desc',
    menuLabel: 'Highest all-time net',
    description: 'Up the most tokens, all-time.',
    format: (v) => (v == null ? '' : `${v >= 0 ? '+' : '−'}${tokens(Math.abs(v))} net`),
  },
  {
    key: 'net_asc',
    metric: 'net',
    direction: 'asc',
    menuLabel: 'Lowest all-time net',
    description: 'Down the most tokens, all-time.',
    format: (v) => (v == null ? '' : `${v >= 0 ? '+' : '−'}${tokens(Math.abs(v))} net`),
  },
  {
    key: 'avg_bet_size_desc',
    metric: 'avg_bet_size',
    direction: 'desc',
    menuLabel: 'Highest average bet',
    description: 'Stakes the most per bet, on average (min. 5 bets).',
    format: (v) => (v == null ? '' : `${tokens(v)} avg. bet`),
  },
  {
    key: 'avg_bet_size_asc',
    metric: 'avg_bet_size',
    direction: 'asc',
    menuLabel: 'Lowest average bet',
    description: 'Stakes the least per bet, on average (min. 5 bets).',
    format: (v) => (v == null ? '' : `${tokens(v)} avg. bet`),
  },
  {
    key: 'distinct_markets_played_desc',
    metric: 'distinct_markets_played',
    direction: 'desc',
    menuLabel: 'Most markets played',
    description: 'Bet on the most different markets.',
    format: (v) => (v == null ? '' : `${Math.round(v)} markets played`),
  },
  {
    key: 'markets_created_desc',
    metric: 'markets_created',
    direction: 'desc',
    menuLabel: 'Most markets created',
    description: 'Started the most markets.',
    format: (v) => (v == null ? '' : `${Math.round(v)} created`),
  },
  {
    key: 'resolutions_proposed_desc',
    metric: 'resolutions_proposed',
    direction: 'desc',
    menuLabel: 'Most resolutions proposed',
    description: 'Called the most results.',
    format: (v) => (v == null ? '' : `${Math.round(v)} proposed`),
  },
  {
    key: 'challenges_raised_desc',
    metric: 'challenges_raised',
    direction: 'desc',
    menuLabel: 'Most challenges raised',
    description: 'Challenged the most called results.',
    format: (v) => (v == null ? '' : `${Math.round(v)} challenges`),
  },
  {
    key: 'votes_cast_desc',
    metric: 'votes_cast',
    direction: 'desc',
    menuLabel: 'Most votes cast',
    description: 'Voted in the most disputes.',
    format: (v) => (v == null ? '' : `${Math.round(v)} votes`),
  },
  {
    key: 'reactions_given_desc',
    metric: 'reactions_given',
    direction: 'desc',
    menuLabel: 'Most reactions given',
    description: 'Reacted to the most resolved markets.',
    format: (v) => (v == null ? '' : `${Math.round(v)} reactions`),
  },
  {
    key: 'times_subject_desc',
    metric: 'times_subject',
    direction: 'desc',
    menuLabel: 'Most talked about',
    description: 'Been the subject of the most markets (once resolved).',
    format: (v) => (v == null ? '' : `${Math.round(v)} markets`),
  },
];

export function findShape(metric: CustomTitleMetric, direction: CustomTitleDirection): CustomAwardShape | undefined {
  return CUSTOM_AWARD_SHAPES.find((s) => s.metric === metric && s.direction === direction);
}

export interface CustomGroupTitle {
  id: string;
  group_id: string;
  label: string;
  emoji: string;
  metric: CustomTitleMetric;
  direction: CustomTitleDirection;
}

/** custom_group_title_holders is a separate table (same "row always exists, even vacant"
    convention as group_titles) — fetched and merged with CustomGroupTitle client-side rather than
    relying on a PostgREST embed. */
export interface CustomGroupTitleHolder {
  custom_title_id: string;
  user_id: string | null;
  stat_value: number | null;
}

