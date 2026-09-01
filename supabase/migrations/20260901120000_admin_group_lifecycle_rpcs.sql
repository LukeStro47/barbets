-- GRP-STATE: a real lifecycle state per private group, replacing the plain
-- active/not-active read admin_group_stats() gives today. Evaluated top-down, first
-- match wins. Thresholds are deliberately the three day-windows this codebase already
-- runs on -- 14 days (admin_group_stats()'s own active window), 30 days (the
-- abandoned-intermission sweep in expire_stale()), and 90 days (the general
-- inactivity deletion sweep) -- not a fourth, independently invented set of numbers.
--
-- _group_lifecycle_state() is a shared private helper so admin_group_lifecycle_states()
-- (the list) and admin_group_detail() (the single-group page, next migration) can never
-- drift on what a given group's state is.
create function _group_lifecycle_state(
  p_group_id uuid,
  p_active_days int default 14,
  p_cooling_days int default 30,
  p_stale_days int default 90
) returns group_lifecycle_state
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_group groups%rowtype;
  v_season seasons%rowtype;
  v_has_market_in_active boolean;
  v_has_bet_in_active boolean;
  v_last_market_at timestamptz;
  v_last_bet_at timestamptz;
  v_last_activity_at timestamptz;
begin
  select * into v_group from groups where id = p_group_id;
  if v_group.id is null then
    return null;
  end if;

  if v_group.deletion_scheduled_at is not null then
    return 'scheduled_for_deletion';
  end if;

  select * into v_season from seasons where group_id = p_group_id order by number desc limit 1;
  if v_season.id is not null and v_season.status = 'winding_down' then
    return 'winding_down';
  end if;
  if v_season.id is not null and v_season.status = 'intermission' then
    return 'intermission';
  end if;

  -- A group younger than the active window hasn't had a fair trailing window to be
  -- judged by the Active rule below yet.
  if v_group.created_at >= now() - (p_active_days || ' days')::interval then
    return 'new';
  end if;

  v_has_market_in_active := exists (
    select 1 from markets m
    where m.group_id = p_group_id and m.created_at >= now() - (p_active_days || ' days')::interval
  );
  v_has_bet_in_active := exists (
    select 1 from bets b join markets m on m.id = b.market_id
    where m.group_id = p_group_id and b.created_at >= now() - (p_active_days || ' days')::interval
  );
  -- Deliberately the same "market created AND bet placed in the trailing window" rule
  -- admin_group_stats() uses for active_private_groups.
  if v_has_market_in_active and v_has_bet_in_active then
    return 'active';
  end if;

  select max(m.created_at) into v_last_market_at from markets m where m.group_id = p_group_id;
  select max(b.created_at) into v_last_bet_at from bets b join markets m on m.id = b.market_id where m.group_id = p_group_id;
  v_last_activity_at := greatest(coalesce(v_last_market_at, '-infinity'::timestamptz), coalesce(v_last_bet_at, '-infinity'::timestamptz));

  if v_last_activity_at >= now() - (p_cooling_days || ' days')::interval then
    return 'cooling';
  end if;

  if v_last_activity_at >= now() - (p_stale_days || ' days')::interval
     or v_group.created_at >= now() - (p_stale_days || ' days')::interval then
    return 'stale';
  end if;

  -- No market/bet activity anywhere in the trailing 90 days and not already
  -- scheduled for deletion -- by the app's own general inactivity sweep this group
  -- should be scheduled already, so it's either blocked by an open non-terminal
  -- market (the sweep leaves those alone) or a deletion was previously cancelled.
  -- Distinct from membership_status = 'dormant', which is a per-member,
  -- opted-out-of-season flag, not a group-level activity read.
  return 'dormant';
end;
$$;

revoke execute on function _group_lifecycle_state(uuid, int, int, int) from public;
revoke execute on function _group_lifecycle_state(uuid, int, int, int) from authenticated;

create function admin_group_lifecycle_states(
  p_active_days int default 14,
  p_cooling_days int default 30,
  p_stale_days int default 90
) returns table (
  group_id uuid,
  group_name text,
  lifecycle_state group_lifecycle_state,
  member_count bigint,
  created_at timestamptz,
  deletion_scheduled_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not is_platform_admin() then
    raise exception 'forbidden: admin only';
  end if;

  return query
  select
    g.id as group_id,
    g.name as group_name,
    _group_lifecycle_state(g.id, p_active_days, p_cooling_days, p_stale_days) as lifecycle_state,
    (select count(*) from memberships mem where mem.group_id = g.id and mem.status in ('active', 'dormant')) as member_count,
    g.created_at,
    g.deletion_scheduled_at
  from groups g
  where g.is_public = false
  order by g.created_at desc;
end;
$$;

revoke execute on function admin_group_lifecycle_states(int, int, int) from public;
grant execute on function admin_group_lifecycle_states(int, int, int) to authenticated;

-- Per-state benchmark cards: what a typical group in each state actually looks like.
-- "Per week" rates use a fixed trailing 28-day window (4 clean weeks) regardless of
-- the state thresholds above, so a group's rate doesn't shrink just because it fell
-- into a state with a shorter lookback.
create function admin_group_lifecycle_state_benchmarks(
  p_active_days int default 14,
  p_cooling_days int default 30,
  p_stale_days int default 90,
  p_rate_window_days int default 28
) returns table (
  lifecycle_state group_lifecycle_state,
  group_count bigint,
  median_members numeric,
  median_bets_per_week numeric,
  median_markets_per_week numeric,
  median_tenure_days numeric,
  most_common_season_length season_length
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not is_platform_admin() then
    raise exception 'forbidden: admin only';
  end if;

  return query
  with states as (
    select
      g.id as group_id,
      _group_lifecycle_state(g.id, p_active_days, p_cooling_days, p_stale_days) as lifecycle_state,
      (select count(*) from memberships mem where mem.group_id = g.id and mem.status in ('active', 'dormant'))::numeric as members,
      (
        select count(*) from bets b join markets m on m.id = b.market_id
        where m.group_id = g.id and b.created_at >= now() - (p_rate_window_days || ' days')::interval
      )::numeric / (p_rate_window_days / 7.0) as bets_per_week,
      (
        select count(*) from markets m
        where m.group_id = g.id and m.created_at >= now() - (p_rate_window_days || ' days')::interval
      )::numeric / (p_rate_window_days / 7.0) as markets_per_week,
      (
        select avg(extract(epoch from now() - mem.joined_at) / 86400)
        from memberships mem where mem.group_id = g.id and mem.status in ('active', 'dormant')
      ) as tenure_days,
      gs.season_length
    from groups g
    left join group_settings gs on gs.group_id = g.id
    where g.is_public = false
  )
  select
    s.lifecycle_state,
    count(*) as group_count,
    percentile_cont(0.5) within group (order by s.members) as median_members,
    percentile_cont(0.5) within group (order by s.bets_per_week) as median_bets_per_week,
    percentile_cont(0.5) within group (order by s.markets_per_week) as median_markets_per_week,
    percentile_cont(0.5) within group (order by s.tenure_days) as median_tenure_days,
    mode() within group (order by s.season_length) as most_common_season_length
  from states s
  group by s.lifecycle_state
  order by s.lifecycle_state;
end;
$$;

revoke execute on function admin_group_lifecycle_state_benchmarks(int, int, int, int) from public;
grant execute on function admin_group_lifecycle_state_benchmarks(int, int, int, int) to authenticated;

-- Of the seasons that entered intermission in the trailing window, what fraction
-- actually started a new season versus are still sitting there. "When did
-- intermission begin" isn't a stable read of the season row's own started_at once it
-- converts -- start_season() overwrites started_at in place when it flips the same
-- row to 'active' -- so this uses the previous season's ended_at instead, set by
-- _end_season() in the same transaction _finalize_season() inserts the intermission
-- row. Known gap: a group deleted while its season is still stuck in intermission
-- cascade-deletes that seasons row, so this can never count intermissions that
-- failed to convert because the whole group died, only ones whose season row still
-- exists. See ARCHITECTURE.md.
create function admin_group_intermission_conversion(p_days int default 90)
returns table (
  total_intermissions bigint,
  converted bigint,
  still_intermission bigint,
  conversion_rate numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not is_platform_admin() then
    raise exception 'forbidden: admin only';
  end if;

  return query
  with intermission_starts as (
    select
      s.status,
      coalesce(prev.ended_at, s.started_at) as intermission_began_at
    from seasons s
    join groups g on g.id = s.group_id
    left join seasons prev on prev.group_id = s.group_id and prev.number = s.number - 1
    where s.number > 1
      and g.is_public = false
  )
  select
    count(*) as total_intermissions,
    count(*) filter (where status <> 'intermission') as converted,
    count(*) filter (where status = 'intermission') as still_intermission,
    round(
      100.0 * count(*) filter (where status <> 'intermission') / nullif(count(*), 0),
      1
    ) as conversion_rate
  from intermission_starts
  where intermission_began_at >= now() - (p_days || ' days')::interval;
end;
$$;

revoke execute on function admin_group_intermission_conversion(int) from public;
grant execute on function admin_group_intermission_conversion(int) to authenticated;
