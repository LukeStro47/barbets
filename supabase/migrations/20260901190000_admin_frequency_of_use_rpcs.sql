-- Frequency-of-use bundle: how often people actually use photo proof, what season
-- length groups typically pick, and how often (and how "advanced") settings changes
-- are. No RPC needed for 5b (share clicks) -- admin_lifecycle_event_totals() already
-- returns per-event_type counts and will pick up 'share_click' rows for free the
-- moment the flag is ever flipped on.

-- 5a: photo proof usage rate. Defaults to excluding voided markets, since the app
-- itself suppresses a proof photo the moment a market voids (a void means the group
-- never settled on what the photo was supposed to prove) -- counting a suppressed
-- photo as "usage" would overstate the rate relative to what anyone could ever
-- actually see. Toggle exposed since this is a real, documented judgment call, not a
-- settled one.
create function admin_photo_proof_usage(p_days int default 90, p_include_voided boolean default false)
returns table (week date, resolved_markets bigint, with_photo bigint, photo_rate numeric)
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
    date_trunc('week', m.resolved_at)::date as week,
    count(*) as resolved_markets,
    count(*) filter (where rp.photo_path is not null) as with_photo,
    round(100.0 * count(*) filter (where rp.photo_path is not null) / nullif(count(*), 0), 1) as photo_rate
  from markets m
  left join resolution_proposals rp on rp.market_id = m.id
  where m.resolved_at is not null
    and m.resolved_at >= now() - (p_days || ' days')::interval
    and (
      m.status = 'resolved'
      or (p_include_voided and m.status = 'voided')
    )
  group by week
  order by week;
end;
$$;

revoke execute on function admin_photo_proof_usage(int, boolean) from public;
grant execute on function admin_photo_proof_usage(int, boolean) to authenticated;

-- 5c: what season length groups typically run, and the trend over time. Reads
-- seasons.season_length (the frozen per-season record set by start_season()), not
-- group_settings.season_length (the mutable current config, which goes stale the
-- moment a group changes it or stops running seasons). Filtered to started_at not
-- null, which naturally excludes a season still sitting unstarted in intermission --
-- its season_length column stays null until start_season() sets it.
create function admin_season_length_distribution(p_weeks int default 26)
returns table (period_start date, season_length season_length, season_count bigint)
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
    date_trunc('week', s.started_at)::date as period_start,
    s.season_length,
    count(*) as season_count
  from seasons s
  join groups g on g.id = s.group_id
  where s.started_at is not null
    and s.started_at >= date_trunc('week', now()) - (p_weeks - 1) * interval '1 week'
    and g.is_public = false
  group by period_start, s.season_length
  order by period_start, s.season_length;
end;
$$;

revoke execute on function admin_season_length_distribution(int) from public;
grant execute on function admin_season_length_distribution(int) to authenticated;

-- 5d: settings change frequency, split basic vs. advanced from the metadata
-- update_group_settings() now writes. Not mutually exclusive -- a single save
-- counted in both updates_basic and updates_advanced touched both tiers, not a
-- double-counting bug.
create function admin_settings_update_frequency(p_days int default 90)
returns table (week date, updates_total bigint, updates_basic bigint, updates_advanced bigint)
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
    date_trunc('week', le.created_at)::date as week,
    count(*) as updates_total,
    count(*) filter (where (le.metadata->>'basic_changed')::boolean) as updates_basic,
    count(*) filter (where (le.metadata->>'advanced_changed')::boolean) as updates_advanced
  from lifecycle_events le
  where le.event_type = 'settings_update'
    and le.created_at >= now() - (p_days || ' days')::interval
  group by week
  order by week;
end;
$$;

revoke execute on function admin_settings_update_frequency(int) from public;
grant execute on function admin_settings_update_frequency(int) to authenticated;
