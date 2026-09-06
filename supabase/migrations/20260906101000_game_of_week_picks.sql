-- game_of_week_picks: one row per (league, week) for the new weekly Game of the Week pipeline.
-- sports-weekly-prepare (Monday) inserts a row per league with that week's Odds API candidates;
-- an admin picks one via pick_game_of_week() from the /admin/game-of-the-week console page;
-- sports-weekly-publish (Tuesday) turns the pick -- or, if nobody made one, a fallback -- into the
-- actual market and stamps market_id/published_at. Keeping this as its own table rather than
-- reusing markets/notification_events lets the admin console show "here's what's pending" and
-- "here's what we picked in past weeks" without needing the market to exist yet, and keeps a
-- record of who actually chose each week's game even after _prune_resolved_system_markets()
-- eventually deletes the market row itself.
--
-- Same "RLS on, zero client-facing policies" shape as pipeline_settings/pipeline_runs: every
-- access goes through a SECURITY DEFINER function (the two below, both is_platform_admin()-gated)
-- or the service-role Edge Functions.
create table game_of_week_picks (
  id uuid primary key default gen_random_uuid(),
  league text not null check (league in ('nfl', 'cfb')),
  -- The Tuesday this pick belongs to -- the day the market actually goes out, not the day
  -- candidates were prepared (Monday). Both sports-weekly-prepare and sports-weekly-publish
  -- compute this the same way (the nearest Tuesday on or after "now"), so a Monday prepare run
  -- and the Tuesday publish run that follows it naturally agree on which row is "this week's".
  week_key date not null,
  group_id uuid not null references groups(id) on delete cascade,
  -- [{event_id, home, away, commence_time}], soonest-kickoff first -- exactly what
  -- sports-weekly-prepare fetched from Odds API's free /events endpoint. Can be empty (a bye
  -- week), which sports-weekly-publish reads as "nothing to publish" rather than a fallback.
  candidates jsonb not null,
  chosen_event_id text,
  -- Null when the eventual pick was sports-weekly-publish's own fallback (the latest-kickoff
  -- candidate) rather than an admin's actual choice -- distinguishes "nobody picked in time" from
  -- "the admin picked the last game on the list" in the past-picks history.
  chosen_by uuid references users(id) on delete set null,
  status text not null default 'awaiting_pick' check (status in ('awaiting_pick', 'picked', 'published', 'skipped')),
  -- Set once sports-weekly-publish actually creates the market. on delete set null rather than
  -- cascade: _prune_resolved_system_markets() eventually hard-deletes old resolved markets, and
  -- that must not take this row's own pick history down with it.
  market_id uuid references markets(id) on delete set null,
  created_at timestamptz not null default now(),
  picked_at timestamptz,
  published_at timestamptz,
  unique (league, week_key)
);

alter table game_of_week_picks enable row level security;

-- list_game_of_week_picks(): everything the admin console's picker page needs -- current pending
-- rows to act on, and past rows for the "how did that go" history. No pagination yet; this grows
-- by exactly 2 rows a week (one per league), so even a couple of years of history is nowhere near
-- worth it.
create function list_game_of_week_picks()
returns setof game_of_week_picks
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not is_platform_admin() then
    raise exception 'forbidden: admin only';
  end if;

  return query select * from game_of_week_picks order by week_key desc, league;
end;
$$;

revoke execute on function list_game_of_week_picks() from public;
grant execute on function list_game_of_week_picks() to authenticated;

-- pick_game_of_week(): records the admin's choice for a still-open week. Deliberately doesn't
-- create the market itself -- sports-weekly-publish does that Tuesday morning regardless of when
-- during the week the pick was made, so every week's market opens at the same predictable time
-- rather than the moment the admin happens to get around to picking. Re-picking before publish
-- (the admin console's "Change pick") is allowed; only a published week is locked.
create function pick_game_of_week(p_pick_id uuid, p_event_id text)
returns game_of_week_picks
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row game_of_week_picks%rowtype;
  v_valid boolean;
begin
  if not is_platform_admin() then
    raise exception 'forbidden: admin only';
  end if;

  select * into v_row from game_of_week_picks where id = p_pick_id for update;
  if v_row.id is null then
    raise exception 'not_found: pick not found';
  end if;

  if v_row.status = 'published' then
    raise exception 'invalid_operation: this week''s market has already gone out, there''s nothing left to change';
  end if;

  select exists (
    select 1 from jsonb_array_elements(v_row.candidates) as c where c ->> 'event_id' = p_event_id
  ) into v_valid;
  if not v_valid then
    raise exception 'invalid_operation: that game isn''t one of this week''s candidates';
  end if;

  update game_of_week_picks
  set chosen_event_id = p_event_id, chosen_by = auth.uid(), status = 'picked', picked_at = now()
  where id = p_pick_id
  returning * into v_row;

  return v_row;
end;
$$;

revoke execute on function pick_game_of_week(uuid, text) from public;
grant execute on function pick_game_of_week(uuid, text) to authenticated;
