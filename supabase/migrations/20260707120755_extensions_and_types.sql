-- Extensions
create extension if not exists citext;

-- Enum types for closed vocabularies defined by the BarBets market/season lifecycle.
create type market_type as enum ('yes_no', 'over_under');

create type market_status as enum (
  'pending_sponsor',
  'open',
  'closed',
  'proposed',
  'disputed',
  'resolved',
  'voided'
);

create type bet_side as enum ('yes', 'no', 'over', 'under');

-- Used for markets.outcome and resolution_proposals.proposed_outcome: a
-- proposer can directly propose VOID (e.g. "criteria unmet"). Votes, by
-- contrast, are cast only among the market's real sides (bet_side) — VOID
-- during a vote is an automatic tie/zero-turnout fallback, not a ballot
-- option, so votes.outcome reuses bet_side rather than this type.
create type market_outcome as enum ('yes', 'no', 'over', 'under', 'void');

create type ledger_entry_type as enum ('seed', 'bet', 'payout', 'refund');

create type membership_status as enum ('active', 'dormant');

create type season_status as enum ('active', 'intermission', 'archived');

create type season_length as enum ('1m', '2m', '3m', 'manual');
