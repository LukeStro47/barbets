-- biggest_single_win could be won by a bet that just returned the bettor's
-- own stake — e.g. a pool where nobody took the other side, so the "winner"
-- is paid back exactly what they put in with no house edge to redistribute.
-- That's the largest 'payout' ledger row by amount in a lopsided market, but
-- it isn't a win, so the recap shouldn't label it one.
--
-- Fix: for a payout row tied to a specific bet (l.bet_id is not null), only
-- count it if it exceeds that bet's own stake (b.amount) — genuine profit.
-- Payout rows with no bet_id (market creator/endorser cuts, the season-end
-- bonus pool split) aren't a stake return by construction and still count
-- unconditionally.
--
-- Same signature as the current latest def (20260823140000), so this is a
-- plain CREATE OR REPLACE — no DROP FUNCTION needed, no overload risk.
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
      select jsonb_build_object('user_id', m.user_id, 'nickname', m.nickname, 'amount', l.amount, 'market_id', l.market_id, 'market_title', mk.title)
      from ledger l
      join memberships m on m.id = l.membership_id
      left join markets mk on mk.id = l.market_id
      left join bets b on b.id = l.bet_id
      where m.group_id = v_season.group_id and l.reason = 'payout' and l.created_at >= v_season.started_at
        and (b.id is null or l.amount > b.amount)
      order by l.amount desc
      limit 1
    ),
    'worst_beat', (
      select jsonb_build_object('user_id', m2.user_id, 'nickname', m2.nickname, 'amount', b.amount, 'market_id', b.market_id, 'market_title', mk2.title)
      from bets b
      join markets mk2 on mk2.id = b.market_id
      join memberships m2 on m2.group_id = mk2.group_id and m2.user_id = b.user_id
      where mk2.group_id = v_season.group_id and mk2.season_id = v_season.id and b.payout = 0
      order by b.amount desc
      limit 1
    ),
    'biggest_upset', (
      select jsonb_build_object(
        'user_id', m3.user_id, 'nickname', m3.nickname, 'market_id', b2.market_id, 'market_title', mk3.title,
        'multiple', round((b2.payout::numeric / b2.amount), 2)
      )
      from bets b2
      join markets mk3 on mk3.id = b2.market_id
      join memberships m3 on m3.group_id = mk3.group_id and m3.user_id = b2.user_id
      where mk3.group_id = v_season.group_id and mk3.season_id = v_season.id and b2.payout > b2.amount
      order by (b2.payout::numeric / b2.amount) desc
      limit 1
    ),
    'markets_settled', (
      select count(*) from markets where season_id = v_season.id and status in ('resolved', 'voided')
    ),
    'tokens_wagered', (
      select coalesce(sum(b3.amount), 0)
      from bets b3
      join markets mk4 on mk4.id = b3.market_id
      where mk4.season_id = v_season.id
    ),
    'bets_placed', (
      select count(*)
      from bets b4
      join markets mk5 on mk5.id = b4.market_id
      where mk5.season_id = v_season.id
    ),
    'titles_snapshot', (
      select coalesce(
        jsonb_agg(jsonb_build_object('title_key', gt.title_key, 'user_id', gt.user_id, 'nickname', m4.nickname, 'stat_value', gt.stat_value)),
        '[]'::jsonb
      )
      from group_titles gt
      left join memberships m4 on m4.group_id = gt.group_id and m4.user_id = gt.user_id
      where gt.group_id = v_season.group_id
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
