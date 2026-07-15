-- Hall of Fame becomes an always-on identity layer instead of an
-- end-of-season-only screen: a handful of flavor titles ("The Oracle",
-- "Whale", ...), each held by at most one member per group at a time,
-- computed from existing bet/ledger history and shown as persistent flair
-- next to a nickname. group_titles holds the current holder (if any) of
-- each title; nothing here is ever written directly by a client — only the
-- SECURITY DEFINER functions in the next migration touch it.
create table group_titles (
  group_id uuid not null references groups (id) on delete cascade,
  title_key text not null check (
    title_key in ('oracle', 'ice_cold', 'bandwagon', 'cursed', 'on_fire', 'degenerate', 'whale', 'risk_taker')
  ),
  -- Null means "nobody currently qualifies" (e.g. not enough settled bets
  -- yet) — a row still exists so the UI can show a vacant-title state
  -- instead of not knowing whether this has ever been computed.
  user_id uuid references users (id) on delete set null,
  -- double precision, not numeric: numeric comes back from Postgres as a
  -- string over PostgREST/supabase-js (precision safety for money), which
  -- this isn't — these are display stats (win rates, streak lengths,
  -- multiples), and float's the type the client-side formatting in
  -- lib/titles.ts actually expects.
  stat_value double precision,
  computed_at timestamptz not null default now(),
  primary key (group_id, title_key)
);

alter table group_titles enable row level security;

create policy group_titles_select on group_titles for select
  to authenticated
  using (
    exists (
      select 1 from memberships m
      where m.group_id = group_titles.group_id and m.user_id = auth.uid()
    )
  );

-- Batched titles (everything except risk_taker, which updates live — see
-- the next migration) only recompute every 3rd market that actually
-- resolves, not on every single one: recomputing after 1 bet flips a title
-- back and forth on noise, but waiting for a whole season is why Hall of
-- Fame needed this rework in the first place. This counter is the cadence.
alter table group_settings add column markets_resolved_since_titles int not null default 0;
