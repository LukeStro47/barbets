export type MarketStatus = 'pending_sponsor' | 'open' | 'closed' | 'proposed' | 'disputed' | 'resolved' | 'voided';

export const STATUS_LABEL: Record<MarketStatus, string> = {
  pending_sponsor: 'Needs a second',
  open: 'Betting open',
  closed: 'Betting closed',
  proposed: 'Outcome proposed',
  disputed: 'Vote required',
  resolved: 'Settled',
  voided: 'Void',
};

// One color per meaning, not per status: red = needs you now, ink = live/active
// (money's on the line), neutral = informational/done. Honey is reserved for money
// figures elsewhere (balances, stakes, pool totals) and never used as a status tone.
export const STATUS_TONE: Record<MarketStatus, 'neutral' | 'ink' | 'danger'> = {
  pending_sponsor: 'danger',
  open: 'ink',
  closed: 'neutral',
  proposed: 'neutral',
  disputed: 'danger',
  resolved: 'neutral',
  voided: 'neutral',
};
