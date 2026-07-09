create table groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_id uuid not null references users (id),
  invite_code citext not null unique,
  created_at timestamptz not null default now()
);

create table group_settings (
  group_id uuid primary key references groups (id) on delete cascade,
  seed_amount int not null check (seed_amount > 0),
  bet_cap_pct int not null check (bet_cap_pct between 1 and 100),
  seasons_enabled boolean not null default false,
  season_length season_length,
  constraint group_settings_season_length_consistency check (
    (seasons_enabled = false and season_length is null)
    or (seasons_enabled = true and season_length is not null)
  )
);

create table memberships (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references groups (id) on delete cascade,
  user_id uuid not null references users (id) on delete cascade,
  balance int not null default 0 check (balance >= 0),
  status membership_status not null default 'active',
  joined_at timestamptz not null default now(),
  unique (group_id, user_id)
);

alter table groups enable row level security;
alter table group_settings enable row level security;
alter table memberships enable row level security;

-- All three tables are member-scoped: you can see a group, its settings, and
-- its roster only if you have a membership row in it. All writes (create,
-- join, settings edits, removals) go through SECURITY DEFINER functions in
-- Phase 2 — no direct INSERT/UPDATE/DELETE policies are granted here, so
-- RLS denies them by default.

create policy groups_select on groups for select
  to authenticated
  using (
    exists (
      select 1 from memberships m
      where m.group_id = groups.id and m.user_id = auth.uid()
    )
  );

create policy group_settings_select on group_settings for select
  to authenticated
  using (
    exists (
      select 1 from memberships m
      where m.group_id = group_settings.group_id and m.user_id = auth.uid()
    )
  );

-- A member can see every membership row (including others' balances) within
-- a group they belong to — the spec's leaderboard requires balances to be
-- visible to fellow group members.
create policy memberships_select on memberships for select
  to authenticated
  using (
    exists (
      select 1 from memberships mine
      where mine.group_id = memberships.group_id and mine.user_id = auth.uid()
    )
  );
