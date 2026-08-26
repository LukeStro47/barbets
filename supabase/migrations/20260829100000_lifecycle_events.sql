-- General-purpose, append-only product-lifecycle log, distinct from
-- notification_events (which is push-delivery bookkeeping for the send-push
-- Edge Function, keyed by an enum that maps to push copy). This table exists
-- to answer growth/retention questions (signups over time, WAU/MAU,
-- retention cohorts) for the new admin analytics site, admin.mybarbets.com,
-- and is read only by admin-gated SECURITY DEFINER functions there.
--
-- Enum, not text, matching this schema's existing convention (bet_side,
-- season_length, notification_event_type, ...) -- an unrecognized event type
-- becomes a migration-time error instead of a silent typo living in a filter
-- forever.
create type lifecycle_event_type as enum (
  'signup',
  'group_join',
  'group_create',
  'season_start',
  'season_end',
  'market_create',
  'bet_place'
);

create table lifecycle_events (
  id bigint generated always as identity primary key,
  event_type lifecycle_event_type not null,
  -- Nullable with on delete set null, same shape as markets.creator_id: an
  -- account can be deleted long after it produced these rows, and losing the
  -- actor shouldn't take the historical event with it. Nothing here reuses
  -- "user_id is null" as a signal for anything else, so that's safe.
  user_id uuid references users (id) on delete set null,
  group_id uuid references groups (id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table lifecycle_events enable row level security;
-- Zero policies, deliberately -- same posture as notification_events,
-- qr_scans, app_admins, feedback: no client role reads or writes this table
-- directly, only SECURITY DEFINER functions insert into it (from inside the
-- existing mutation functions it's recording) and only admin-gated SECURITY
-- DEFINER functions read out of it.

create index lifecycle_events_type_created_at_idx on lifecycle_events (event_type, created_at);
create index lifecycle_events_user_id_idx on lifecycle_events (user_id);
