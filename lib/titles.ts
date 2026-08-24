export type TitleKey = 'oracle' | 'ice_cold' | 'degenerate' | 'risk_taker';

export interface TitleMeta {
  label: string;
  description: string;
  /** The icon key (from lib/awardIcons.ts) shown when the owner hasn't picked a custom one. */
  defaultIconKey: string;
  format: (value: number | null) => string;
}

/** Display order everywhere titles are listed (Awards, badge stacking). */
export const TITLE_ORDER: TitleKey[] = ['oracle', 'ice_cold', 'degenerate', 'risk_taker'];

export const TITLE_META: Record<TitleKey, TitleMeta> = {
  oracle: {
    label: 'The Oracle',
    description: 'Highest win rate in the group (min. 5 settled bets).',
    defaultIconKey: 'target',
    format: (v) => (v == null ? '' : `${Math.round(v * 100)}% win rate`),
  },
  ice_cold: {
    label: 'Ice Cold',
    description: 'Lowest win rate in the group (min. 5 settled bets).',
    defaultIconKey: 'snowflake',
    format: (v) => (v == null ? '' : `${Math.round(v * 100)}% win rate`),
  },
  degenerate: {
    label: 'Degenerate',
    description: 'Placed the most bets, ever.',
    defaultIconKey: 'clock',
    format: (v) => (v == null ? '' : `${v} bets placed`),
  },
  risk_taker: {
    label: 'Risk Taker',
    description: "The single biggest underdog win in the group's history, by payout multiple.",
    defaultIconKey: 'spike',
    format: (v) => (v == null ? '' : `${v}x payout`),
  },
};

export interface GroupTitleRow {
  title_key: TitleKey;
  user_id: string | null;
  stat_value: number | null;
  /** Owner overrides — null means "use TITLE_META's default." */
  label: string | null;
  icon_key: string | null;
}

export interface TitleBadge {
  key: TitleKey;
  label: string;
  description: string;
  stat: string;
  iconKey: string;
}

/** Builds a userId -> badges map of the titles someone holds — the member record's "Awards held"
    section lists these directly (icon, label, and the stat that earned it) rather than just a
    count behind a link. Vacant titles (null user_id) are skipped. */
export function titlesByUser(rows: GroupTitleRow[]): Map<string, TitleBadge[]> {
  const map = new Map<string, TitleBadge[]>();
  for (const key of TITLE_ORDER) {
    const row = rows.find((r) => r.title_key === key);
    if (!row?.user_id) continue;
    const meta = TITLE_META[key];
    const arr = map.get(row.user_id) ?? [];
    arr.push({
      key,
      label: row.label ?? meta.label,
      description: meta.description,
      stat: meta.format(row.stat_value),
      iconKey: row.icon_key ?? meta.defaultIconKey,
    });
    map.set(row.user_id, arr);
  }
  return map;
}
