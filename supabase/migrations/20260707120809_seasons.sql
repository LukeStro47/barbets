create table seasons (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references groups (id) on delete cascade,
  number int not null check (number > 0),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  status season_status not null default 'active',
  unique (group_id, number)
);

-- season_optins reference the *next* season a member wants to opt into,
-- collected during the current season's intermission (or filed late,
-- any time before/after the next season starts).
create table season_optins (
  season_id uuid not null references seasons (id) on delete cascade,
  user_id uuid not null references users (id) on delete cascade,
  opted_at timestamptz not null default now(),
  primary key (season_id, user_id)
);

create table season_results (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references groups (id) on delete cascade,
  season_id uuid not null references seasons (id) on delete cascade,
  snapshot jsonb not null,
  created_at timestamptz not null default now()
);

alter table seasons enable row level security;
alter table season_optins enable row level security;
alter table season_results enable row level security;

-- All three are member-scoped, same shape as groups/memberships. Writes
-- (end_season, start_season, opt_in_season) go through Phase 2 functions.

create policy seasons_select on seasons for select
  to authenticated
  using (
    exists (
      select 1 from memberships m
      where m.group_id = seasons.group_id and m.user_id = auth.uid()
    )
  );

-- Opt-in status is visible to the whole group, not just the opting-in user —
-- the intermission screen shows a live "who's in" list and the owner's
-- start button shows an opt-in count, per spec.
create policy season_optins_select on season_optins for select
  to authenticated
  using (
    exists (
      select 1 from seasons s
      join memberships m on m.group_id = s.group_id
      where s.id = season_optins.season_id and m.user_id = auth.uid()
    )
  );

create policy season_results_select on season_results for select
  to authenticated
  using (
    exists (
      select 1 from memberships m
      where m.group_id = season_results.group_id and m.user_id = auth.uid()
    )
  );
