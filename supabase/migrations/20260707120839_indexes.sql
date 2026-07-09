-- Supporting indexes not already provided by a PRIMARY KEY / UNIQUE
-- constraint. The first three back is_market_visible() and its sibling
-- predicate directly, since every market read in the app runs through them.

-- Reverse of memberships' unique(group_id, user_id): "which groups is this
-- user in" lookups (group hub, is_market_visible's join).
create index idx_memberships_user_group on memberships (user_id, group_id);

-- Reverse of market_subjects' PK(market_id, user_id): "which markets is
-- this user a subject of" lookups.
create index idx_market_subjects_user on market_subjects (user_id, market_id);

-- Group feed: markets in a group filtered/grouped by status.
create index idx_markets_group_status on markets (group_id, status);

-- Season-scoped queries (season-end voiding, hall of fame, history).
create index idx_markets_season on markets (season_id);

-- expire_stale() cron scans: partial indexes so it only has to touch the
-- small slice of markets actually eligible for a timer-driven transition,
-- not the whole table.
create index idx_markets_open_closes_at on markets (closes_at) where status = 'open';
create index idx_markets_pending_sponsor_created on markets (created_at) where status = 'pending_sponsor';

-- get_closed_odds() aggregates by side; "my bets" queries filter by user
-- across markets.
create index idx_bets_market_side on bets (market_id, side);
create index idx_bets_user_market on bets (user_id, market_id);

-- Balance history / "my private staked total" reads, newest first.
create index idx_ledger_membership_created on ledger (membership_id, created_at desc);
