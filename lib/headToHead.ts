/** Shared shapes for a head-to-head comparison, read by `get_member_stats()` (once per side) and
 *  `get_head_to_head_markets()`. Pure types only, so both the server-rendered vs/ page and the
 *  client-callable `loadHeadToHead` action (see lib/actions/memberProfile.ts) can import them. */
export interface HeadToHeadMemberStats {
  membership_id: string;
  group_id: string;
  user_id: string;
  nickname: string;
  balance: number;
  net: number;
  accuracy_pct: number | null;
  tokens_wagered: number;
  avatarUpdatedAt: string | null;
  avatarPresetKey: string | null;
}

export interface HeadToHeadMarket {
  market_id: string;
  title: string;
  resolved_at: string;
  a_amount: number;
  a_payout: number;
  a_choice: string;
  b_amount: number;
  b_payout: number;
  b_choice: string;
}

export interface HeadToHeadData {
  a: HeadToHeadMemberStats;
  b: HeadToHeadMemberStats;
  markets: HeadToHeadMarket[];
}
