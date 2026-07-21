-- Bug fix: 20260720110000_group_wide_bonus_pool.sql redefined
-- _finalize_season(p_season_id uuid) — one argument — to add the
-- pending_bonus_pool even-split. But 20260719149000_finalize_season_actor.sql
-- had already changed the real signature to
-- _finalize_season(p_season_id uuid, p_actor_id uuid default null), and every
-- call site (end_season, _maybe_archive_winding_down_season) passes both
-- args. CREATE OR REPLACE only replaces an exact signature match, so that
-- migration silently created a second, dead overload: the one with the
-- actor param (the one every caller actually resolves to) never got the
-- pending_bonus_pool distribution logic. Exactly the trailing-parameter
-- gotcha ARCHITECTURE.md warns about, fallen into despite the warning.
-- Fixing it here: drop the accidental 1-arg overload, restore the 2-arg
-- signature with both the actor-attribution fix and the pending_bonus_pool
-- split combined.
drop function if exists _finalize_season(uuid);

create or replace function _finalize_season(p_season_id uuid, p_actor_id uuid default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_season seasons%rowtype;
  v_next_number int;
  v_snapshot jsonb;
  v_pending_bonus int;
  v_active_count int;
  v_share int;
  v_dust int;
  rec record;
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

  select pending_bonus_pool into v_pending_bonus from groups where id = v_season.group_id for update;
  if v_pending_bonus > 0 then
    select count(*) into v_active_count from memberships where group_id = v_season.group_id and status = 'active';

    if v_active_count > 0 then
      v_share := floor(v_pending_bonus::numeric / v_active_count)::int;
      v_dust := v_pending_bonus - v_share * v_active_count;

      for rec in
        with ranked as (
          select id, row_number() over (order by balance desc, user_id) as rn
          from memberships
          where group_id = v_season.group_id and status = 'active'
        )
        select id, v_share + (case when rn = 1 then v_dust else 0 end) as amount
        from ranked
      loop
        if rec.amount > 0 then
          update memberships set balance = balance + rec.amount where id = rec.id;
          insert into ledger (membership_id, amount, reason) values (rec.id, rec.amount, 'payout');
        end if;
      end loop;

      update groups set pending_bonus_pool = 0 where id = v_season.group_id;
    end if;
  end if;

  select coalesce(max(number), 0) + 1 into v_next_number from seasons where group_id = v_season.group_id;

  insert into seasons (group_id, number, status)
  values (v_season.group_id, v_next_number, 'intermission');
end;
$$;

revoke execute on function _finalize_season(uuid, uuid) from public;
revoke execute on function _finalize_season(uuid, uuid) from authenticated;
