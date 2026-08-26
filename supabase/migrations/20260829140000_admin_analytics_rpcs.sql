-- Admin-gated read RPCs for the new admin.mybarbets.com analytics site.
-- Same is_platform_admin()-gate / revoke-from-public / grant-to-authenticated
-- pattern as every other admin RPC (see list_qr_scan_totals()).
--
-- Note on why WAU/MAU and retention read from lifecycle_events rather than
-- users.last_active_at: last_active_at is a single mutable column, stamped
-- in place on every request (see touch_last_active() in
-- 20260829110000_last_active_at.sql) -- it only ever holds a user's *most
-- recent* activity, so it cannot answer "was this user active during some
-- past week," only "are they active right now." lifecycle_events is an
-- append-only log, so it's the only signal here with real history to query
-- a trend or a cohort grid against. The tradeoff: lifecycle_events only
-- fires on the seven mutation-type events instrumented in
-- 20260829130000_lifecycle_event_instrumentation.sql, not on passive
-- browsing, so these two RPCs undercount pure-reading sessions that
-- touch_last_active() itself would catch. Worth revisiting only if that gap
-- turns out to matter in practice.

create function admin_signups_per_day(p_days int default 90)
returns table (day date, signups bigint)
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
  select gs.day::date, count(u.id) as signups
  from generate_series(
    date_trunc('day', now()) - (p_days - 1) * interval '1 day',
    date_trunc('day', now()),
    interval '1 day'
  ) as gs(day)
  left join users u on date_trunc('day', u.created_at) = gs.day
  group by gs.day
  order by gs.day;
end;
$$;

revoke execute on function admin_signups_per_day(int) from public;
grant execute on function admin_signups_per_day(int) to authenticated;

create function admin_wau_mau(p_weeks int default 26)
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
      select count(distinct le.user_id) from lifecycle_events le
      where le.user_id is not null
        and le.created_at >= gs.week_start
        and le.created_at < gs.week_start + interval '7 days'
    ) as wau,
    (
      select count(distinct le.user_id) from lifecycle_events le
      where le.user_id is not null
        and le.created_at >= gs.week_start - interval '23 days'
        and le.created_at < gs.week_start + interval '7 days'
    ) as mau
  from generate_series(
    date_trunc('week', now()) - (p_weeks - 1) * interval '1 week',
    date_trunc('week', now()),
    interval '1 week'
  ) as gs(week_start)
  order by gs.week_start;
end;
$$;

revoke execute on function admin_wau_mau(int) from public;
grant execute on function admin_wau_mau(int) to authenticated;

-- Cohort-by-week-offset grid: cohort_week is the signup week, weeks_since_signup
-- is the offset, cohort_size is how many users signed up that week, and
-- active_users is how many of them had at least one lifecycle_event during
-- that specific offset week. A plain cross join over cohorts x offsets is
-- fine unoptimized at current friend-group scale (dozens to low hundreds of
-- users) -- no materialized view or pre-aggregation warranted yet.
create function admin_retention_cohorts(p_cohort_weeks int default 12)
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
    select c.cohort_week, o.weeks_since_signup, count(distinct c.user_id) as active_users
    from cohorts c
    cross join offsets o
    join lifecycle_events le
      on le.user_id = c.user_id
      and le.created_at >= c.cohort_week + (o.weeks_since_signup * interval '1 week')
      and le.created_at < c.cohort_week + ((o.weeks_since_signup + 1) * interval '1 week')
    group by c.cohort_week, o.weeks_since_signup
  )
  select g.cohort_week, g.weeks_since_signup, g.cohort_size, coalesce(a.active_users, 0) as active_users
  from grid g
  left join activity a on a.cohort_week = g.cohort_week and a.weeks_since_signup = g.weeks_since_signup
  order by g.cohort_week, g.weeks_since_signup;
end;
$$;

revoke execute on function admin_retention_cohorts(int) from public;
grant execute on function admin_retention_cohorts(int) to authenticated;

-- Coarse per-type counts, useful mainly as an "is instrumentation actually
-- firing" sanity check underneath the growth charts.
create function admin_lifecycle_event_totals(p_days int default 30)
returns table (event_type lifecycle_event_type, event_count bigint)
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
  select le.event_type, count(*) as event_count
  from lifecycle_events le
  where le.created_at >= now() - (p_days || ' days')::interval
  group by le.event_type
  order by le.event_type;
end;
$$;

revoke execute on function admin_lifecycle_event_totals(int) from public;
grant execute on function admin_lifecycle_event_totals(int) to authenticated;
