-- Fixes a real bug that's existed since admin_retention_cohorts() was first written
-- (20260829140000): PL/pgSQL implicitly exposes a RETURNS TABLE's column names as variables
-- inside the function body, so any bare (unqualified) column reference in the embedded SQL that
-- happens to share a name with an OUT column -- cohort_week, weeks_since_signup, cohort_size,
-- active_users, all four of them here -- is ambiguous between "the plpgsql variable" and "the
-- query column." `select cohort_week, count(*) ... from cohorts group by cohort_week` inside the
-- cohort_sizes CTE hit exactly this, raising `column reference "cohort_week" is ambiguous` on
-- every call. Never caught until just now, calling it end-to-end as a real authenticated admin
-- rather than only checking the underlying table joins directly -- the previous verification for
-- 20260829180000/190000 stopped at confirming the raw SQL was correct and never actually invoked
-- the deployed function through the is_platform_admin() gate.
--
-- The fix is the standard one for this PL/pgSQL gotcha: qualify every column reference with its
-- source table/CTE name, everywhere, so nothing is ever a bare identifier that could resolve to
-- the OUT parameter instead. Same signature, plain CREATE OR REPLACE.
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
    select cohorts.cohort_week, count(*) as cohort_size
    from cohorts
    group by cohorts.cohort_week
  ),
  offsets as (
    select generate_series(0, p_cohort_weeks - 1) as weeks_since_signup
  ),
  grid as (
    select cohort_sizes.cohort_week, offsets.weeks_since_signup, cohort_sizes.cohort_size
    from cohort_sizes
    cross join offsets
    where cohort_sizes.cohort_week + (offsets.weeks_since_signup * interval '1 week') <= date_trunc('week', now())
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
    select cohorts.cohort_week, offsets.weeks_since_signup, count(distinct cohorts.user_id) as active_users
    from cohorts
    cross join offsets
    join activity
      on activity.user_id = cohorts.user_id
      and activity.created_at >= cohorts.cohort_week + (offsets.weeks_since_signup * interval '1 week')
      and activity.created_at < cohorts.cohort_week + ((offsets.weeks_since_signup + 1) * interval '1 week')
    group by cohorts.cohort_week, offsets.weeks_since_signup
  )
  select grid.cohort_week, grid.weeks_since_signup, grid.cohort_size, coalesce(cohort_activity.active_users, 0) as active_users
  from grid
  left join cohort_activity
    on cohort_activity.cohort_week = grid.cohort_week and cohort_activity.weeks_since_signup = grid.weeks_since_signup
  order by grid.cohort_week, grid.weeks_since_signup;
end;
$$;
