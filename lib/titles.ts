export type TitleKey = 'oracle' | 'ice_cold' | 'bandwagon' | 'cursed' | 'on_fire' | 'degenerate' | 'whale' | 'risk_taker';

export interface TitleMeta {
  label: string;
  description: string;
  format: (value: number | null) => string;
}

/** Display order everywhere titles are listed (Awards, badge stacking). */
export const TITLE_ORDER: TitleKey[] = ['oracle', 'ice_cold', 'bandwagon', 'cursed', 'on_fire', 'degenerate', 'whale', 'risk_taker'];

export const TITLE_META: Record<TitleKey, TitleMeta> = {
  oracle: {
    label: 'The Oracle',
    description: 'Highest win rate in the group (min. 5 settled bets).',
    format: (v) => (v == null ? '' : `${Math.round(v * 100)}% win rate`),
  },
  ice_cold: {
    label: 'Ice Cold',
    description: 'Lowest win rate in the group (min. 5 settled bets).',
    format: (v) => (v == null ? '' : `${Math.round(v * 100)}% win rate`),
  },
  bandwagon: {
    label: 'Bandwagon',
    description: "Bets on the crowd favorite more than anyone else (min. 5 settled bets).",
    format: (v) => (v == null ? '' : `${Math.round(v * 100)}% on the favorite`),
  },
  cursed: {
    label: 'Cursed',
    description: "The group's longest active losing streak.",
    format: (v) => (v == null ? '' : `${v}-bet losing streak`),
  },
  on_fire: {
    label: 'On Fire',
    description: "The group's longest active winning streak.",
    format: (v) => (v == null ? '' : `${v}-bet winning streak`),
  },
  degenerate: {
    label: 'Degenerate',
    description: 'Placed the most bets, ever.',
    format: (v) => (v == null ? '' : `${v} bets placed`),
  },
  whale: {
    label: 'Whale',
    description: 'Wagered the most tokens, ever.',
    format: (v) => (v == null ? '' : `${Math.round(v).toLocaleString()} wagered`),
  },
  risk_taker: {
    label: 'Risk Taker',
    description: "The single biggest underdog win in the group's history, by payout multiple.",
    format: (v) => (v == null ? '' : `${v}x payout`),
  },
};

export interface GroupTitleRow {
  title_key: TitleKey;
  user_id: string | null;
  stat_value: number | null;
}

export interface TitleBadge {
  key: TitleKey;
  label: string;
}

/** Builds a userId -> badges map of the titles someone holds. No longer used to render flair next
    to a nickname (that emoji-badge treatment was removed from Mention) — just a count/list, e.g.
    the member profile page's "Holds N awards" link. Vacant titles (null user_id) are skipped. */
export function titlesByUser(rows: GroupTitleRow[]): Map<string, TitleBadge[]> {
  const map = new Map<string, TitleBadge[]>();
  for (const key of TITLE_ORDER) {
    const row = rows.find((r) => r.title_key === key);
    if (!row?.user_id) continue;
    const meta = TITLE_META[key];
    const arr = map.get(row.user_id) ?? [];
    arr.push({ key, label: meta.label });
    map.set(row.user_id, arr);
  }
  return map;
}
