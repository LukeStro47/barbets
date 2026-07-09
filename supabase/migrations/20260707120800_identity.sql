-- Public profile row, 1:1 with auth.users. Created by the "claim username" step
-- after signup, not automatically, since a user must pick a username before
-- they have an identity usable anywhere else in the app.
create table users (
  id uuid primary key references auth.users (id) on delete cascade,
  username citext not null unique,
  display_name text,
  created_at timestamptz not null default now(),
  -- citext's ~ operator is case-insensitive, so the format check casts to text
  -- first — otherwise "ABC_123" would incorrectly pass an "a-z" pattern.
  constraint users_username_format check (username::text ~ '^[a-z0-9_]{3,20}$')
);

alter table users enable row level security;

-- Any authenticated user can look up any other user's public identity
-- (usernames are the mention/leaderboard primitive) — this table carries no
-- group-scoped or privacy-sensitive data.
create policy users_select_all on users for select
  to authenticated
  using (true);

create policy users_insert_own on users for insert
  to authenticated
  with check (id = auth.uid());

-- No update policy: username/display_name changes go through a function later
-- if ever needed. No delete policy: rows are cleaned up via the auth.users
-- cascade, not client deletes.
