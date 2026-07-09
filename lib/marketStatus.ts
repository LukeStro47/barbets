export type MarketStatus = 'pending_sponsor' | 'open' | 'closed' | 'proposed' | 'disputed' | 'resolved' | 'voided';

export const STATUS_LABEL: Record<MarketStatus, string> = {
  pending_sponsor: 'Awaiting endorsement',
  open: 'Open',
  closed: 'Awaiting resolution',
  proposed: 'Resolution proposed',
  disputed: 'Vote in progress',
  resolved: 'Resolved',
  voided: 'Voided',
};

export const STATUS_TONE: Record<MarketStatus, 'neutral' | 'honey' | 'success' | 'danger'> = {
  pending_sponsor: 'neutral',
  open: 'honey',
  closed: 'honey',
  proposed: 'neutral',
  disputed: 'danger',
  resolved: 'success',
  voided: 'neutral',
};
