-- CHURN: group cohort retention (structurally mirrors admin_retention_cohorts(), one
-- level up) plus membership churn split early vs. late. Depends on
-- memberships.status_changed_at from the prior migration.

-- "Active" here is week-bucketed presence of any market or bet event for the group
-- that week -- a third distinct "active" definition in this codebase, alongside
-- GRP-STATE's day-windowed AND-based rule and admin_group_stats()'s 14-day AND-based
-- rule. See ARCHITECTURE.md's note on not conflating these.
create function admin_group_cohort_retention(p_cohort_weeks int default 12)
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
    select cohort_week, count(*) as cohort_size
    from cohorts
    group by cohort_week
  ),
  offsets as (
    select generate_series(0, p_cohort_weeks - 1) as weeks_since_creation
  ),
  grid as (
    select cs.cohort_week, o.weeks_since_creation, cs.cohort_size
    from cohort_sizes cs
    cross join offsets o
    where cs.cohort_week + (o.weeks_since_creation * interval '1 week') <= date_trunc('week', now())
  ),
  activity as (
    select m.group_id, m.created_at from markets m
    union all
    select mk.group_id, b.created_at from bets b join markets mk on mk.id = b.market_id
  ),
  cohort_activity as (
    select c.cohort_week, o.weeks_since_creation, count(distinct c.group_id) as active_groups
    from cohorts c
    cross join offsets o
    join activity a
      on a.group_id = c.group_id
      and a.created_at >= c.cohort_week + (o.weeks_since_creation * interval '1 week')
      and a.created_at < c.cohort_week + ((o.weeks_since_creation + 1) * interval '1 week')
    group by c.cohort_week, o.weeks_since_creation
  )
  select g.cohort_week, g.weeks_since_creation, g.cohort_size, coalesce(ca.active_groups, 0) as active_groups
  from grid g
  left join cohort_activity ca on ca.cohort_week = g.cohort_week and ca.weeks_since_creation = g.weeks_since_creation
  order by g.cohort_week, g.weeks_since_creation;
end;
$$;

revoke execute on function admin_group_cohort_retention(int) from public;
grant execute on function admin_group_cohort_retention(int) to authenticated;

-- Early churn (left within a week of joining, an onboarding problem) vs. late churn
-- (a long-tenured member leaving, a group going stale from the inside). The 7-day
-- boundary reuses the same "haven't engaged in a group for a week" precedent
-- market_closing_soon's recipient filter already uses, rather than inventing a new
-- number.
create function admin_membership_churn(p_join_window_days int default 180)
returns table (
  total_joins bigint,
  early_churn bigint,
  late_churn bigint,
  still_here bigint,
  early_churn_rate numeric,
  late_churn_rate numeric
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
  with cohort as (
    select status, joined_at, status_changed_at
    from memberships
    where joined_at >= now() - (p_join_window_days || ' days')::interval
  )
  select
    count(*) as total_joins,
    count(*) filter (where status in ('left', 'removed') and status_changed_at - joined_at <= interval '7 days') as early_churn,
    count(*) filter (where status in ('left', 'removed') and status_changed_at - joined_at > interval '7 days') as late_churn,
    count(*) filter (where status in ('active', 'dormant')) as still_here,
    round(100.0 * count(*) filter (where status in ('left', 'removed') and status_changed_at - joined_at <= interval '7 days') / nullif(count(*), 0), 1) as early_churn_rate,
    round(100.0 * count(*) filter (where status in ('left', 'removed') and status_changed_at - joined_at > interval '7 days') / nullif(count(*), 0), 1) as late_churn_rate
  from cohort;
end;
$$;

revoke execute on function admin_membership_churn(int) from public;
grant execute on function admin_membership_churn(int) to authenticated;
