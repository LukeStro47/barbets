-- GRP-DRILL: a single-group detail view for the admin panel. Pure reads against
-- existing tables plus season_results.snapshot (a rich per-season rollup already
-- computed once at season close and, until now, never surfaced anywhere in the admin
-- panel). No schema changes.

create function admin_group_detail(p_group_id uuid)
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
    (select mem.nickname from memberships mem where mem.group_id = g.id and mem.user_id = g.owner_id) as owner_nickname,
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

revoke execute on function admin_group_detail(uuid) from public;
grant execute on function admin_group_detail(uuid) to authenticated;

create function admin_group_roster(p_group_id uuid)
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
    mem.nickname,
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

revoke execute on function admin_group_roster(uuid) from public;
grant execute on function admin_group_roster(uuid) to authenticated;

create function admin_group_activity_timeline(p_group_id uuid, p_days int default 90)
returns table (day date, markets_created bigint, bets_placed bigint, members_joined bigint)
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
    gs.day::date,
    (select count(*) from markets m where m.group_id = p_group_id and date_trunc('day', m.created_at) = gs.day) as markets_created,
    (select count(*) from bets b join markets m on m.id = b.market_id where m.group_id = p_group_id and date_trunc('day', b.created_at) = gs.day) as bets_placed,
    (select count(*) from memberships mem where mem.group_id = p_group_id and date_trunc('day', mem.joined_at) = gs.day) as members_joined
  from generate_series(
    date_trunc('day', now()) - (p_days - 1) * interval '1 day',
    date_trunc('day', now()),
    interval '1 day'
  ) as gs(day)
  order by gs.day;
end;
$$;

revoke execute on function admin_group_activity_timeline(uuid, int) from public;
grant execute on function admin_group_activity_timeline(uuid, int) to authenticated;

-- Season-over-season trend: straight read of seasons joined to season_results, no new
-- aggregation. The client pulls champion/tokens_wagered/bets_placed/markets_settled
-- straight out of each season's frozen snapshot.
create function admin_group_season_history(p_group_id uuid)
returns table (
  season_id uuid,
  number int,
  status season_status,
  started_at timestamptz,
  ended_at timestamptz,
  season_length season_length,
  snapshot jsonb
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
  select s.id as season_id, s.number, s.status, s.started_at, s.ended_at, s.season_length, sr.snapshot
  from seasons s
  left join season_results sr on sr.season_id = s.id
  where s.group_id = p_group_id
  order by s.number;
end;
$$;

revoke execute on function admin_group_season_history(uuid) from public;
grant execute on function admin_group_season_history(uuid) to authenticated;

-- Fleet-wide, not single-group: whether group size correlates with engagement per
-- member. Belongs on the groups overview/list page (a scatter plot), not the
-- single-group detail page, even though it answers a GRP-DRILL question.
create function admin_group_size_engagement_correlation(p_active_days int default 14)
returns table (group_id uuid, group_name text, member_count int, bets_per_member_per_week numeric)
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
    (select count(*) from memberships mem where mem.group_id = g.id and mem.status in ('active', 'dormant'))::int as member_count,
    case when (select count(*) from memberships mem where mem.group_id = g.id and mem.status in ('active', 'dormant')) > 0
      then (
        select count(*) from bets b join markets m on m.id = b.market_id
        where m.group_id = g.id and b.created_at >= now() - (p_active_days || ' days')::interval
      )::numeric
        / (select count(*) from memberships mem where mem.group_id = g.id and mem.status in ('active', 'dormant'))
        / (p_active_days / 7.0)
      else 0
    end as bets_per_member_per_week
  from groups g
  where g.is_public = false;
end;
$$;

revoke execute on function admin_group_size_engagement_correlation(int) from public;
grant execute on function admin_group_size_engagement_correlation(int) to authenticated;
