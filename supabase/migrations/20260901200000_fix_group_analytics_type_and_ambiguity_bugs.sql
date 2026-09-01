-- Fixes three real bugs in the group/user analytics RPCs added this session, all caught only by
-- actually invoking each function end-to-end as a real authenticated admin (same lesson as
-- 20260829200000_fix_retention_cohorts_ambiguous_column.sql -- a migration applying cleanly only
-- proves plpgsql's check_function_bodies pass caught obvious errors, not that the function runs
-- correctly).
--
-- 1. percentile_cont() returns double precision, not numeric, even when the sort expression is
--    numeric -- admin_group_lifecycle_state_benchmarks() and admin_user_segments() both declared
--    their median_* columns as numeric and raised "structure of query does not match function
--    result type" on every call. Fixed with an explicit ::numeric cast on each percentile_cont
--    result.
-- 2. memberships.nickname is citext, not text -- admin_group_detail()'s owner_nickname and
--    admin_group_roster()'s nickname both declared text and hit the same structure-mismatch error.
--    Fixed with an explicit ::text cast.
-- 3. admin_group_cohort_retention() copied the ORIGINAL (buggy) admin_retention_cohorts() pattern
--    rather than the already-fixed one: PL/pgSQL implicitly exposes a RETURNS TABLE's column names
--    as variables inside the function body, so a bare reference to cohort_week inside the
--    cohort_sizes CTE was ambiguous between "the plpgsql OUT variable" and "the query column" --
--    the exact bug 20260829200000 already fixed once for the user-level version. Same fix here:
--    qualify every column reference with its source CTE name throughout.
--
-- Same signatures as their originals, plain CREATE OR REPLACE, no drop needed.

create or replace function admin_group_lifecycle_state_benchmarks(
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
    (percentile_cont(0.5) within group (order by s.members))::numeric as median_members,
    (percentile_cont(0.5) within group (order by s.bets_per_week))::numeric as median_bets_per_week,
    (percentile_cont(0.5) within group (order by s.markets_per_week))::numeric as median_markets_per_week,
    (percentile_cont(0.5) within group (order by s.tenure_days))::numeric as median_tenure_days,
    mode() within group (order by s.season_length) as most_common_season_length
  from states s
  group by s.lifecycle_state
  order by s.lifecycle_state;
end;
$$;

create or replace function admin_user_segments(p_power_bets_per_week numeric default 3)
returns table (
  segment user_engagement_segment,
  user_count bigint,
  pct_of_total numeric,
  median_bets_per_week numeric,
  median_active_memberships numeric,
  median_tenure_days numeric
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
  with segments as (
    select
      u.id as user_id,
      _user_engagement_segment(u.id, p_power_bets_per_week) as segment,
      (select count(*) from bets b where b.user_id = u.id and b.created_at >= now() - interval '28 days')::numeric / 4.0 as bets_per_week,
      (select count(*) from memberships mem where mem.user_id = u.id and mem.status = 'active')::numeric as active_memberships,
      extract(epoch from now() - u.created_at) / 86400 as tenure_days
    from users u
  ),
  total as (
    select count(*) as n from segments
  )
  select
    s.segment,
    count(*) as user_count,
    round(100.0 * count(*) / nullif((select n from total), 0), 1) as pct_of_total,
    (percentile_cont(0.5) within group (order by s.bets_per_week))::numeric as median_bets_per_week,
    (percentile_cont(0.5) within group (order by s.active_memberships))::numeric as median_active_memberships,
    (percentile_cont(0.5) within group (order by s.tenure_days))::numeric as median_tenure_days
  from segments s
  group by s.segment
  order by s.segment;
end;
$$;

create or replace function admin_group_cohort_retention(p_cohort_weeks int default 12)
returns table (cohort_week date, weeks_since_creation int, cohort_size bigint, active_groups bigint)
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
  with cohorts as (
    select date_trunc('week', g.created_at)::date as cohort_week, g.id as group_id
    from groups g
    where g.is_public = false
      and g.created_at >= date_trunc('week', now()) - (p_cohort_weeks - 1) * interval '1 week'
  ),
  cohort_sizes as (
    select cohorts.cohort_week, count(*) as cohort_size
    from cohorts
    group by cohorts.cohort_week
  ),
  offsets as (
    select generate_series(0, p_cohort_weeks - 1) as weeks_since_creation
  ),
  grid as (
    select cohort_sizes.cohort_week, offsets.weeks_since_creation, cohort_sizes.cohort_size
    from cohort_sizes
    cross join offsets
    where cohort_sizes.cohort_week + (offsets.weeks_since_creation * interval '1 week') <= date_trunc('week', now())
  ),
  activity as (
    select m.group_id, m.created_at from markets m
    union all
    select mk.group_id, b.created_at from bets b join markets mk on mk.id = b.market_id
  ),
  cohort_activity as (
    select cohorts.cohort_week, offsets.weeks_since_creation, count(distinct cohorts.group_id) as active_groups
    from cohorts
    cross join offsets
    join activity
      on activity.group_id = cohorts.group_id
      and activity.created_at >= cohorts.cohort_week + (offsets.weeks_since_creation * interval '1 week')
      and activity.created_at < cohorts.cohort_week + ((offsets.weeks_since_creation + 1) * interval '1 week')
    group by cohorts.cohort_week, offsets.weeks_since_creation
  )
  select grid.cohort_week, grid.weeks_since_creation, grid.cohort_size, coalesce(cohort_activity.active_groups, 0) as active_groups
  from grid
  left join cohort_activity
    on cohort_activity.cohort_week = grid.cohort_week and cohort_activity.weeks_since_creation = grid.weeks_since_creation
  order by grid.cohort_week, grid.weeks_since_creation;
end;
$$;

create or replace function admin_group_detail(p_group_id uuid)
returns table (
  id uuid,
  name text,
  owner_id uuid,
  owner_nickname text,
  is_public boolean,
  category text,
  created_at timestamptz,
  member_count bigint,
  active_member_count bigint,
  lifecycle_state group_lifecycle_state,
  deletion_scheduled_at timestamptz,
  current_season_id uuid,
  current_season_number int,
  current_season_status season_status,
  current_season_ends_at timestamptz,
  total_markets bigint,
  total_bets bigint,
  total_tokens_wagered bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_season seasons%rowtype;
begin
  if not is_platform_admin() then
    raise exception 'forbidden: admin only';
  end if;

  select * into v_season from seasons where group_id = p_group_id order by number desc limit 1;

  return query
  select
    g.id,
    g.name,
    g.owner_id,
    (select mem.nickname::text from memberships mem where mem.group_id = g.id and mem.user_id = g.owner_id) as owner_nickname,
    g.is_public,
    g.category,
    g.created_at,
    (select count(*) from memberships mem where mem.group_id = g.id and mem.status in ('active', 'dormant')) as member_count,
    (select count(*) from memberships mem where mem.group_id = g.id and mem.status = 'active') as active_member_count,
    _group_lifecycle_state(g.id) as lifecycle_state,
    g.deletion_scheduled_at,
    v_season.id as current_season_id,
    v_season.number as current_season_number,
    v_season.status as current_season_status,
    v_season.ends_at as current_season_ends_at,
    (select count(*) from markets m where m.group_id = g.id) as total_markets,
    (select count(*) from bets b join markets m on m.id = b.market_id where m.group_id = g.id) as total_bets,
    (select coalesce(sum(b.amount), 0) from bets b join markets m on m.id = b.market_id where m.group_id = g.id) as total_tokens_wagered
  from groups g
  where g.id = p_group_id;
end;
$$;

create or replace function admin_group_roster(p_group_id uuid)
returns table (
  membership_id uuid,
  user_id uuid,
  nickname text,
  role text,
  status membership_status,
  joined_at timestamptz,
  balance int,
  bets_placed bigint,
  markets_created bigint,
  last_bet_at timestamptz
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
    mem.id as membership_id,
    mem.user_id,
    mem.nickname::text,
    mem.role,
    mem.status,
    mem.joined_at,
    mem.balance,
    (select count(*) from bets b join markets m on m.id = b.market_id where m.group_id = p_group_id and b.user_id = mem.user_id) as bets_placed,
    (select count(*) from markets m where m.group_id = p_group_id and m.creator_id = mem.user_id) as markets_created,
    (select max(b.created_at) from bets b join markets m on m.id = b.market_id where m.group_id = p_group_id and b.user_id = mem.user_id) as last_bet_at
  from memberships mem
  where mem.group_id = p_group_id
  order by mem.balance desc;
end;
$$;
