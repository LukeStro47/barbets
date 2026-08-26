-- Corrects a real design mistake in admin_group_stats() / admin_wau_mau() / admin_retention_cohorts():
-- all three read exclusively from lifecycle_events, which only started recording the moment
-- 20260829100000_lifecycle_events.sql shipped, with no backfill. That's fine for the retention
-- cohort grid (already labeled "data since <date>" in the UI) but actively wrong for "active
-- group" and the WAU/MAU trend, which both need history the brand-new log simply doesn't have
-- yet -- "active group" in particular requires *both* a market_create *and* a bet_place event on
-- the same group within the trailing window, which is very unlikely to have happened entirely
-- within the few hours since deployment even for a genuinely active group, so it read 0 for
-- everyone.
--
-- The fix: markets, bets, and memberships already carry real historical created_at timestamps
-- going back to day one -- there was never a need to route these three metrics through a new
-- event log when the underlying facts already live in tables that have existed since launch.
-- lifecycle_events stays as-is and still backs admin_lifecycle_event_totals() (an honest
-- "is instrumentation firing" sanity check, not a historical metric) and is still the only
-- source for anything that can't be reconstructed after the fact, like group_delete -- a
-- deleted group's row is gone, so there is no other way to count it. Same 3 signatures, plain
-- CREATE OR REPLACE, no drop needed.

create or replace function admin_group_stats(p_active_days int default 14)
returns table (
  active_private_groups bigint,
  total_private_groups bigint,
  scheduled_for_deletion bigint,
  deleted_last_30d bigint
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
    (
      select count(*) from groups g
      where g.is_public = false
        and exists (
          select 1 from markets m
          where m.group_id = g.id and m.created_at >= now() - (p_active_days || ' days')::interval
        )
        and exists (
          select 1 from bets b
          join markets m on m.id = b.market_id
          where m.group_id = g.id and b.created_at >= now() - (p_active_days || ' days')::interval
        )
    ) as active_private_groups,
    (select count(*) from groups where is_public = false) as total_private_groups,
    (select count(*) from groups where deletion_scheduled_at is not null) as scheduled_for_deletion,
    (select count(*) from lifecycle_events where event_type = 'group_delete' and created_at >= now() - interval '30 days') as deleted_last_30d;
end;
$$;

-- WAU/MAU: "active" is now a user with a membership created (covers both group_create and
-- group_join, since creating a group also inserts the creator's own membership row), a market
-- created, or a bet placed, in the relevant window -- the same three real historical tables
-- admin_group_stats() now uses, unioned per user.
create or replace function admin_wau_mau(p_weeks int default 26)
returns table (period_start date, wau bigint, mau bigint)
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
    gs.week_start::date as period_start,
    (
      select count(distinct a.user_id) from (
        select user_id, created_at from memberships
        union all
        select creator_id as user_id, created_at from markets where creator_id is not null
        union all
        select user_id, created_at from bets
      ) a
      where a.created_at >= gs.week_start and a.created_at < gs.week_start + interval '7 days'
    ) as wau,
    (
      select count(distinct a.user_id) from (
        select user_id, created_at from memberships
        union all
        select creator_id as user_id, created_at from markets where creator_id is not null
        union all
        select user_id, created_at from bets
      ) a
      where a.created_at >= gs.week_start - interval '23 days' and a.created_at < gs.week_start + interval '7 days'
    ) as mau
  from generate_series(
    date_trunc('week', now()) - (p_weeks - 1) * interval '1 week',
    date_trunc('week', now()),
    interval '1 week'
  ) as gs(week_start)
  order by gs.week_start;
end;
$$;

-- Retention cohorts: same activity union as admin_wau_mau, in place of the lifecycle_events join.
create or replace function admin_retention_cohorts(p_cohort_weeks int default 12)
returns table (cohort_week date, weeks_since_signup int, cohort_size bigint, active_users bigint)
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
    select date_trunc('week', u.created_at)::date as cohort_week, u.id as user_id
    from users u
    where u.created_at >= date_trunc('week', now()) - (p_cohort_weeks - 1) * interval '1 week'
  ),
  cohort_sizes as (
    select cohort_week, count(*) as cohort_size
    from cohorts
    group by cohort_week
  ),
  offsets as (
    select generate_series(0, p_cohort_weeks - 1) as weeks_since_signup
  ),
  grid as (
    select cs.cohort_week, o.weeks_since_signup, cs.cohort_size
    from cohort_sizes cs
    cross join offsets o
    where cs.cohort_week + (o.weeks_since_signup * interval '1 week') <= date_trunc('week', now())
  ),
  activity as (
    select a.user_id, a.created_at
    from (
      select user_id, created_at from memberships
      union all
      select creator_id as user_id, created_at from markets where creator_id is not null
      union all
      select user_id, created_at from bets
    ) a
  ),
  cohort_activity as (
    select c.cohort_week, o.weeks_since_signup, count(distinct c.user_id) as active_users
    from cohorts c
    cross join offsets o
    join activity a
      on a.user_id = c.user_id
      and a.created_at >= c.cohort_week + (o.weeks_since_signup * interval '1 week')
      and a.created_at < c.cohort_week + ((o.weeks_since_signup + 1) * interval '1 week')
    group by c.cohort_week, o.weeks_since_signup
  )
  select g.cohort_week, g.weeks_since_signup, g.cohort_size, coalesce(ca.active_users, 0) as active_users
  from grid g
  left join cohort_activity ca on ca.cohort_week = g.cohort_week and ca.weeks_since_signup = g.weeks_since_signup
  order by g.cohort_week, g.weeks_since_signup;
end;
$$;
