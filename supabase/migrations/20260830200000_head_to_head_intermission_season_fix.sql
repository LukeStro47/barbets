-- Fixes get_head_to_head_markets() picking the wrong season during intermission.
--
-- 20260823150000 scoped it to "most recent season by number, regardless of status" on the
-- assumption that during intermission there's no next season's history yet either way. That
-- overlooked _finalize_season() (20260719144000): the moment a season archives, it immediately
-- inserts a new, higher-numbered 'intermission' row for the season about to start. So "most
-- recent by number" during intermission resolves to that brand-new, empty row -- not the season
-- that just ended and actually has the shared bet history -- and a comparison during intermission
-- always came back with zero shared markets.
--
-- The leaderboard and group-hub pages already work around this by explicitly looking up
-- `number - 1` once they see an 'intermission' row. This does the equivalent without depending on
-- number arithmetic: prefer whichever season is currently live (active, or winding_down while its
-- last markets resolve), and only when neither exists, fall back to the most recently archived
-- one -- which during intermission is exactly the season that just ended.
create or replace function get_head_to_head_markets(p_membership_id_a uuid, p_membership_id_b uuid)
returns table (
  market_id uuid,
  title text,
  resolved_at timestamptz,
  a_amount bigint,
  a_payout bigint,
  a_choice text,
  b_amount bigint,
  b_payout bigint,
  b_choice text
)
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_a memberships%rowtype;
  v_b memberships%rowtype;
  v_season_id uuid;
begin
  select * into v_a from memberships where id = p_membership_id_a;
  select * into v_b from memberships where id = p_membership_id_b;

  if v_a.id is null or v_b.id is null or v_a.status = 'removed' or v_b.status = 'removed' then
    raise exception 'not_found: member not found';
  end if;

  if v_a.group_id <> v_b.group_id then
    raise exception 'not_found: member not found';
  end if;

  if not _caller_is_active_group_member(v_a.group_id) then
    raise exception 'not_found: member not found';
  end if;

  select id into v_season_id from seasons
  where group_id = v_a.group_id and status in ('active', 'winding_down')
  order by number desc limit 1;

  if v_season_id is null then
    select id into v_season_id from seasons
    where group_id = v_a.group_id and status = 'archived'
    order by number desc limit 1;
  end if;

  return query
  with a_bets as (
    select b.market_id, sum(b.amount)::bigint as amount, sum(b.payout)::bigint as payout,
           (array_agg(coalesce(mo.label, b.side::text) order by b.amount desc))[1] as choice
    from bets b
    left join market_options mo on mo.id = b.option_id
    where b.user_id = v_a.user_id
    group by b.market_id
  ),
  b_bets as (
    select b.market_id, sum(b.amount)::bigint as amount, sum(b.payout)::bigint as payout,
           (array_agg(coalesce(mo.label, b.side::text) order by b.amount desc))[1] as choice
    from bets b
    left join market_options mo on mo.id = b.option_id
    where b.user_id = v_b.user_id
    group by b.market_id
  )
  select m.id, m.title, m.resolved_at, a.amount, a.payout, a.choice, b.amount, b.payout, b.choice
  from markets m
  join a_bets a on a.market_id = m.id
  join b_bets b on b.market_id = m.id
  where m.group_id = v_a.group_id and m.status = 'resolved'
    and (v_season_id is null or m.season_id = v_season_id)
  order by m.resolved_at desc;
end;
$$;

revoke execute on function get_head_to_head_markets(uuid, uuid) from public;
grant execute on function get_head_to_head_markets(uuid, uuid) to authenticated;
