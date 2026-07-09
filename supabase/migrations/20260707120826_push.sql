create table push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth_key text not null,
  created_at timestamptz not null default now(),
  unique (user_id, endpoint)
);

-- Per-user notification toggle referenced in the spec's Profile page
-- ("Per-user notification toggles"). One flag is enough for v1 — a
-- per-category toggle set can be added later without touching this table.
alter table users add column notifications_enabled boolean not null default true;

alter table push_subscriptions enable row level security;

-- Own rows only, full CRUD — unlike the money/privacy-sensitive tables,
-- subscription rows are just a user's own device registrations, so there's
-- no need to route writes through a SECURITY DEFINER function.
create policy push_subscriptions_all_own on push_subscriptions for all
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
