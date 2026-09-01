-- USR-SEG: per-user engagement segment, evaluated top-down, first match wins.
-- Recency thresholds reuse admin_wau_mau()'s own two windows (7 days for WAU, 30 days
-- for MAU) plus the 14-day New-account grace window from GRP-STATE and the 90-day
-- "gone" threshold from the inactivity deletion sweep -- not a fifth set of numbers.
-- The one genuinely new number here is the 3-bets/week Power cutoff (12 bets over a
-- 28-day, 4-week average) -- there's no existing precedent to anchor it to, so treat
-- it as a starting point, recalibrate once admin_group_lifecycle_state_benchmarks()
-- has produced a real bets-per-week distribution to check it against. See
-- ARCHITECTURE.md.
create function _user_engagement_segment(p_user_id uuid, p_power_bets_per_week numeric default 3)
returns user_engagement_segment
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_user users%rowtype;
  v_ever_member boolean;
  v_currently_member boolean;
  v_active_memberships int;
  v_last_active timestamptz;
  v_bets_28d int;
begin
  select * into v_user from users where id = p_user_id;
  if v_user.id is null then
    return null;
  end if;

  v_ever_member := exists (select 1 from memberships where user_id = p_user_id);
  v_currently_member := exists (select 1 from memberships where user_id = p_user_id and status in ('active', 'dormant'));

  if v_ever_member and not v_currently_member then
    return 'churned';
  end if;

  if v_user.created_at >= now() - interval '14 days' then
    return 'new';
  end if;

  select count(*) into v_active_memberships from memberships where user_id = p_user_id and status = 'active';
  v_last_active := coalesce(v_user.last_active_at, v_user.created_at);
  select count(*) into v_bets_28d from bets where user_id = p_user_id and created_at >= now() - interval '28 days';

  if v_active_memberships > 0
     and v_last_active >= now() - interval '7 days'
     and v_bets_28d >= (p_power_bets_per_week * 4) then
    return 'power';
  end if;

  if v_active_memberships > 0 and v_last_active >= now() - interval '30 days' then
    return 'casual';
  end if;

  if v_last_active >= now() - interval '90 days' then
    return 'at_risk';
  end if;

  return 'dormant';
end;
$$;

revoke execute on function _user_engagement_segment(uuid, numeric) from public;
revoke execute on function _user_engagement_segment(uuid, numeric) from authenticated;

create function admin_user_segments(p_power_bets_per_week numeric default 3)
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
    percentile_cont(0.5) within group (order by s.bets_per_week) as median_bets_per_week,
    percentile_cont(0.5) within group (order by s.active_memberships) as median_active_memberships,
    percentile_cont(0.5) within group (order by s.tenure_days) as median_tenure_days
  from segments s
  group by s.segment
  order by s.segment;
end;
$$;

revoke execute on function admin_user_segments(numeric) from public;
grant execute on function admin_user_segments(numeric) to authenticated;

-- Bettor vs. creator/sponsor vs. joiner-who-never-bets, over a trailing window.
create function admin_user_activity_mix(p_days int default 90)
returns table (mix_type text, user_count bigint)
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
  with recent_bettors as (
    select distinct user_id from bets where created_at >= now() - (p_days || ' days')::interval
  ),
  recent_creators as (
    select distinct creator_id as user_id from markets where creator_id is not null and created_at >= now() - (p_days || ' days')::interval
    union
    select distinct sponsor_id as user_id from markets where sponsor_id is not null and created_at >= now() - (p_days || ' days')::interval
  ),
  recent_members as (
    select distinct user_id from memberships where status in ('active', 'dormant')
  ),
  classified as (
    select
      m.user_id,
      case
        when rb.user_id is not null and rc.user_id is not null then 'bettor_and_creator'
        when rb.user_id is not null then 'bettor_only'
        when rc.user_id is not null then 'creator_or_sponsor'
        else 'joiner_never_bets'
      end as mix_type
    from recent_members m
    left join recent_bettors rb on rb.user_id = m.user_id
    left join recent_creators rc on rc.user_id = m.user_id
  )
  select c.mix_type, count(*) as user_count
  from classified c
  group by c.mix_type
  order by c.mix_type;
end;
$$;

revoke execute on function admin_user_activity_mix(int) from public;
grant execute on function admin_user_activity_mix(int) to authenticated;

-- How many groups a user is currently in, bucketed, and whether being in more
-- groups correlates with being thinner or more engaged per group.
create function admin_user_multigroup_distribution()
returns table (active_membership_bucket text, user_count bigint)
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
  with counts as (
    select u.id as user_id, count(mem.id) filter (where mem.status in ('active', 'dormant')) as n
    from users u
    left join memberships mem on mem.user_id = u.id
    group by u.id
  )
  select
    case
      when n = 0 then '0'
      when n = 1 then '1'
      when n = 2 then '2'
      when n = 3 then '3'
      when n = 4 then '4'
      else '5+'
    end as active_membership_bucket,
    count(*) as user_count
  from counts
  group by 1
  order by 1;
end;
$$;

revoke execute on function admin_user_multigroup_distribution() from public;
grant execute on function admin_user_multigroup_distribution() to authenticated;
