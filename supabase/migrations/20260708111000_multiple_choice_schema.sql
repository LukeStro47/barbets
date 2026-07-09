-- Multiple choice markets, schema half. A market_options row is one of 2-10
-- named, mutually exclusive answers ("who's first to leave the party: @dan /
-- @priya / @sam / someone else") — the count bound is enforced in
-- create_market(), not here.
--
-- Every place that used to carry a bet_side/market_outcome now also has an
-- option_id sibling column, following one convention throughout: exactly one
-- of the two is ever populated for a given row (VOID always goes through the
-- outcome/bet_side column as 'void', never through an option_id — VOID isn't
-- an option). That XOR is enforced with a same-table CHECK constraint in
-- each case; it deliberately doesn't need to know the row's market_type,
-- because place_bet()/propose_resolution()/cast_vote() are what cross-check
-- the actual market_type against which column the caller populated (the
-- same division of labor the codebase already uses for "side must match
-- market_type", which is a function-level check, not a static one).
create table market_options (
  id uuid primary key default gen_random_uuid(),
  market_id uuid not null references markets (id) on delete cascade,
  label text not null,
  sort_order int not null,
  unique (market_id, label)
);

alter table market_options enable row level security;

-- Same predicate as every other market-scoped table: an option list is just
-- as subject-revealing as the market itself, so it rides on
-- is_market_visible() unchanged.
create policy market_options_select on market_options for select
  to authenticated
  using (is_market_visible(market_id));

create index idx_market_options_market on market_options (market_id, sort_order);

-- Per-option subjects. Nullable and unused (stays null) for yes_no/over_under
-- markets, whose subjects are market-level as before. For multiple_choice,
-- each row is scoped to the option whose label @mentioned that user.
-- Privacy is still market-level regardless of option — is_market_visible()
-- already matches on market_id alone, so being @'d in any single option
-- still hides the whole market (seeing any option would reveal the market
-- exists).
alter table market_subjects add column option_id uuid references market_options (id) on delete cascade;

-- bets: side (existing) and option_id (new) are mutually exclusive — a bet
-- is on a bet_side XOR on an option, never both, never neither.
alter table bets alter column side drop not null;
alter table bets add column option_id uuid references market_options (id) on delete cascade;
alter table bets add constraint bets_side_xor_option check (
  (side is not null and option_id is null) or (side is null and option_id is not null)
);
create index idx_bets_market_option on bets (market_id, option_id) where option_id is not null;

-- markets: outcome_option_id is the winning option once resolved. Convention
-- (matching bets above): outcome_option_id and outcome are mutually
-- exclusive — a market resolves to a bet_side/void outcome XOR to a specific
-- option, and outcome_option_id can only ever be set on a multiple_choice
-- market (checked against markets' own market_type column, no join needed).
alter table markets add column outcome_option_id uuid references market_options (id);
alter table markets add constraint markets_outcome_xor_option check (
  outcome is null or outcome_option_id is null
);
alter table markets add constraint markets_outcome_option_only_multiple_choice check (
  outcome_option_id is null or market_type = 'multiple_choice'
);

-- markets_line_required_for_over_under widens: multiple_choice joins yes_no
-- in "never has a line" (line is O/U-only, options carry the choices).
alter table markets drop constraint markets_line_required_for_over_under;
alter table markets add constraint markets_line_required_for_over_under check (
  (market_type in ('yes_no', 'multiple_choice') and line is null)
  or (market_type = 'over_under' and line is not null)
);

-- markets_resolved_requires_outcome widens: a resolved market needs *either*
-- an outcome or a winning option, not necessarily both (multiple_choice
-- resolves via outcome_option_id, leaving outcome null; every other type
-- keeps resolving via outcome, leaving outcome_option_id null).
alter table markets drop constraint markets_resolved_requires_outcome;
alter table markets add constraint markets_resolved_requires_outcome check (
  status <> 'resolved' or ((outcome is not null or outcome_option_id is not null) and resolved_at is not null)
);

-- resolution_proposals: proposed_option_id mirrors outcome_option_id above,
-- same XOR-with-proposed_outcome convention.
alter table resolution_proposals alter column proposed_outcome drop not null;
alter table resolution_proposals add column proposed_option_id uuid references market_options (id);
alter table resolution_proposals add constraint resolution_proposals_outcome_xor_option check (
  (proposed_outcome is not null and proposed_option_id is null) or (proposed_outcome is null and proposed_option_id is not null)
);

-- votes: voted_option_id mirrors the same convention — a ballot is cast for
-- a bet_side/VOID XOR for a specific option.
alter table votes alter column outcome drop not null;
alter table votes add column voted_option_id uuid references market_options (id);
alter table votes add constraint votes_outcome_xor_option check (
  (outcome is not null and voted_option_id is null) or (outcome is null and voted_option_id is not null)
);
