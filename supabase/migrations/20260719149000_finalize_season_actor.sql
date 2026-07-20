-- _finalize_season gains an actor param: end_season()'s common fast path
-- (nothing was in flight, archives synchronously in the same call) should
-- still attribute season_ended to the owner who actually clicked "End
-- season now" — same as it always has. Only the deferred paths
-- (finalize_market's tail hook archiving a winding_down season well after
-- the fact, or expire_stale's hard-cap sweep) have no honest actor to
-- attribute it to.
drop function if exists _finalize_season(uuid);

create function _finalize_season(p_season_id uuid, p_actor_id uuid default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_season seasons%rowtype;
  v_next_number int;
  v_snapshot jsonb;
begin
  select * into v_season from seasons where id = p_season_id for update;
  if v_season.id is null then
    return;
  end if;

  select jsonb_build_object(
    'champion', (
      select jsonb_build_object('user_id', m.user_id, 'nickname', m.nickname, 'balance', m.balance)
      from memberships m
      where m.group_id = v_season.group_id and m.status <> 'removed'
      order by m.balance desc, m.user_id
      limit 1
    ),
    'final_balances', (
      select coalesce(
        jsonb_agg(jsonb_build_object('user_id', m.user_id, 'nickname', m.nickname, 'balance', m.balance) order by m.balance desc),
        '[]'::jsonb
      )
      from memberships m
      where m.group_id = v_season.group_id and m.status <> 'removed'
    ),
    'biggest_single_win', (
      select jsonb_build_object('user_id', m.user_id, 'nickname', m.nickname, 'amount', l.amount, 'market_id', l.market_id)
      from ledger l
      join memberships m on m.id = l.membership_id
      where m.group_id = v_season.group_id and l.reason = 'payout' and l.created_at >= v_season.started_at
      order by l.amount desc
      limit 1
    ),
    'worst_beat', (
      select jsonb_build_object('user_id', m2.user_id, 'nickname', m2.nickname, 'amount', b.amount, 'market_id', b.market_id)
      from bets b
      join markets mk on mk.id = b.market_id
      join memberships m2 on m2.group_id = mk.group_id and m2.user_id = b.user_id
      where mk.group_id = v_season.group_id and mk.season_id = v_season.id and b.payout = 0
      order by b.amount desc
      limit 1
    )
  ) into v_snapshot;

  insert into season_results (group_id, season_id, snapshot)
  values (v_season.group_id, v_season.id, v_snapshot);

  update seasons set status = 'archived' where id = v_season.id;

  perform _emit_notification_event('season_ended', v_season.group_id, null, v_season.id, p_actor_id);

  select coalesce(max(number), 0) + 1 into v_next_number from seasons where group_id = v_season.group_id;

  insert into seasons (group_id, number, status)
  values (v_season.group_id, v_next_number, 'intermission');
end;
$$;

revoke execute on function _finalize_season(uuid, uuid) from public;
revoke execute on function _finalize_season(uuid, uuid) from authenticated;

create or replace function end_season(p_group_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_group groups%rowtype;
  v_season seasons%rowtype;
  v_in_flight int;
  rec record;
begin
  select * into v_group from groups where id = p_group_id;
  if v_group.id is null then
    raise exception 'not_found: group not found';
  end if;

  perform 1 from memberships where group_id = p_group_id and user_id = v_caller and status <> 'removed';
  if not found then
    raise exception 'not_found: group not found';
  end if;

  if v_caller <> v_group.owner_id then
    raise exception 'forbidden: only the group owner can end the season';
  end if;

  select * into v_season from seasons where group_id = p_group_id and status = 'active' for update;
  if v_season.id is null then
    raise exception 'invalid_operation: no active season to end';
  end if;

  for rec in
    select id from markets
    where season_id = v_season.id and status in ('pending_sponsor', 'open', 'closed')
    for update
  loop
    perform _void_market(rec.id);
  end loop;

  select count(*) into v_in_flight
  from markets
  where season_id = v_season.id and status in ('proposed', 'disputed');

  update seasons set ended_at = now() where id = v_season.id;

  if v_in_flight = 0 then
    perform _finalize_season(v_season.id, v_caller);
  else
    update seasons
    set status = 'winding_down', wind_down_deadline = now() + interval '8 hours'
    where id = v_season.id;
  end if;
end;
$$;

revoke execute on function end_season(uuid) from public;
grant execute on function end_season(uuid) to authenticated;

create or replace function _maybe_archive_winding_down_season(p_season_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_remaining int;
begin
  perform 1 from seasons where id = p_season_id and status = 'winding_down';
  if not found then
    return;
  end if;

  select count(*) into v_remaining
  from markets
  where season_id = p_season_id and status in ('proposed', 'disputed');

  if v_remaining = 0 then
    -- No single honest actor: this fires from finalize_market's tail hook
    -- (whoever cleared the last vote/challenge didn't "end the season") or
    -- from expire_stale's hard-cap sweep.
    perform _finalize_season(p_season_id, null);
  end if;
end;
$$;

revoke execute on function _maybe_archive_winding_down_season(uuid) from public;
revoke execute on function _maybe_archive_winding_down_season(uuid) from authenticated;
