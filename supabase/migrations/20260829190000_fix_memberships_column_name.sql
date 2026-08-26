-- Fixes a genuine bug in the migration just before this one (20260829180000): memberships has no
-- created_at column, it's called joined_at. The raw union query I used to verify the fix before
-- pushing caught it immediately -- select user_id, created_at from memberships raises
-- "column created_at does not exist" -- which means admin_wau_mau() and admin_retention_cohorts()
-- as deployed a moment ago would raise the identical error the first time either was actually
-- called. Caught before any real caller hit it. Same 2 signatures, plain CREATE OR REPLACE.

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
        select user_id, joined_at as created_at from memberships
        union all
        select creator_id as user_id, created_at from markets where creator_id is not null
        union all
        select user_id, created_at from bets
      ) a
      where a.created_at >= gs.week_start and a.created_at < gs.week_start + interval '7 days'
    ) as wau,
    (
      select count(distinct a.user_id) from (
        select user_id, joined_at as created_at from memberships
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
      select user_id, joined_at as created_at from memberships
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
