-- Schema for unified season formats: custom end dates, a per-season betting
-- gate, the wind-down grace period, season naming, and a new season_optouts
-- table for currently-active members pre-emptively skipping the next
-- season. season_optins is left completely untouched (see below) — this is
-- deliberately NOT a rename, after tracing _cleanup_departing_member()
-- (20260708093000_leave_rejoin_patch.sql), which deletes a departing
-- member's season_optins row on every leave/remove. If "opted out" meant
-- "no row" the way "opted in" does today, that same cleanup call would
-- silently un-exclude a departing member instead of excluding them — they'd
-- get auto-reseeded into the next season without ever asking to come back.
-- Keeping the two tables separate (season_optins: a dormant member asking
-- in; season_optouts: an active member asking out) closes that gap for free
-- and needs zero changes to join_group/opt_in_season/_cleanup_departing_member.

alter table seasons add column ends_at timestamptz; -- frozen at start_season time; null = manual/no fixed end
alter table seasons add column season_length season_length; -- frozen copy of group_settings.season_length, mirrors the existing seed_amount freeze
alter table seasons add column betting_open boolean not null default false; -- per-season market-creation gate; supersedes group_settings.betting_enabled once seasons_enabled is true
alter table seasons add column wind_down_deadline timestamptz; -- set only while status = 'winding_down'; 8h hard cap past the season's end
alter table seasons add column name text; -- optional owner label, e.g. "Friday Game Night"; null falls back to "Season N" in the UI

alter table group_settings add column season_custom_ends_at timestamptz;

alter table group_settings drop constraint group_settings_season_length_consistency;
alter table group_settings add constraint group_settings_season_length_consistency check (
  (seasons_enabled = false and season_length is null and season_custom_ends_at is null)
  or (seasons_enabled = true and season_length is not null
      and (season_length = 'custom') = (season_custom_ends_at is not null))
);

create table season_optouts (
  season_id uuid not null references seasons (id) on delete cascade,
  user_id uuid not null references users (id) on delete cascade,
  opted_out_at timestamptz not null default now(),
  primary key (season_id, user_id)
);

alter table season_optouts enable row level security;

-- Same shape as season_optins_select: whole-group, select-only, non-removed
-- members — the intermission screen needs to show a live roster either way.
create policy season_optouts_select on season_optouts for select using (
  exists (
    select 1 from seasons s
    where s.id = season_optouts.season_id and _caller_is_active_group_member(s.group_id)
  )
);

-- No client-facing insert/update/delete policy — same deny-by-default
-- posture as every other table here. All writes go through
-- opt_out_season()/cancel_season_optout().

alter table notification_events drop constraint notification_events_market_events_have_market;
alter table notification_events add constraint notification_events_market_events_have_market check (
  (event_type in (
    'season_ended', 'betting_opened', 'member_joined',
    'group_deletion_scheduled', 'group_deletion_canceled', 'group_titles_updated',
    'season_betting_opened', 'group_deletion_scheduled_inactivity'
  ))
  or (market_id is not null)
);
