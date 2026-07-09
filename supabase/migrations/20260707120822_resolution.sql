-- At most one resolution proposal per market: once proposed, a market moves
-- to 'proposed' and either auto-finalizes (no challenge in 24h) or moves to
-- 'disputed' for a vote — there is no path back to an unproposed state that
-- would allow a second, independent proposal.
create table resolution_proposals (
  id uuid primary key default gen_random_uuid(),
  market_id uuid not null unique references markets (id) on delete cascade,
  proposer_id uuid not null references users (id),
  proposed_outcome market_outcome not null,
  justification text,
  actual_value numeric,
  proposed_at timestamptz not null default now(),
  finalized boolean not null default false,
  -- Set only when a vote is actually tallied (the disputed path). A market
  -- resolved via the no-challenge fast path never had a vote, so ballots for
  -- it should never appear "revealed" — see is_market_visible()'s sibling
  -- predicate for votes in the RLS policies migration.
  votes_revealed_at timestamptz
  -- "actual_value only meaningful for over_under markets" is cross-table
  -- (needs markets.market_type) and validated in propose_resolution().
);

-- A single challenge is enough to move a market into the vote phase; a
-- second challenge on the same market is redundant, hence unique(market_id).
create table challenges (
  id uuid primary key default gen_random_uuid(),
  market_id uuid not null unique references markets (id) on delete cascade,
  challenger_id uuid not null references users (id),
  created_at timestamptz not null default now()
);

-- Secret ballot: one vote per member per market. outcome is a bet_side
-- (the market's real sides), not market_outcome — VOID is never a ballot
-- choice, only the automatic result of a tie or zero turnout.
create table votes (
  id uuid primary key default gen_random_uuid(),
  market_id uuid not null references markets (id) on delete cascade,
  voter_id uuid not null references users (id),
  outcome bet_side not null,
  created_at timestamptz not null default now(),
  unique (market_id, voter_id)
);

alter table resolution_proposals enable row level security;
alter table challenges enable row level security;
alter table votes enable row level security;

-- All three depend on is_market_visible() (proposals/challenges are visible
-- once the market itself is visible; votes are additionally gated on
-- votes_revealed_at) — real policies live in
-- 20260707120835_rls_policies.sql. RLS-enabled-with-no-policy denies all
-- access until then.
