-- Lets a group's owner (or a public group's moderator, though it's forced null there same as
-- join_message) say what's actually on the line: a prize for whoever finishes on top and a
-- punishment for whoever finishes last. Free text, same shape as join_message.
alter table group_settings add column prize_text text;
alter table group_settings add column punishment_text text;

-- Adds two trailing params to update_group_settings, so per the project's function-signature rule
-- this needs an explicit drop of the old 15-arg signature first, same as 20260822130000 did when
-- it added join_message.
drop function if exists update_group_settings(uuid, int, boolean, season_length, text, boolean, boolean, boolean, int, boolean, timestamptz, numeric, boolean, text, boolean);

create function update_group_settings(
  p_group_id uuid,
  p_seed_amount int,
  p_seasons_enabled boolean,
  p_season_length season_length default null,
  p_timezone text default 'UTC',
  p_betting_enabled boolean default false,
  p_accepting_members boolean default true,
  p_distribute_payout boolean default false,
  p_creator_payout_pct int default 25,
  p_allow_hedged_bets boolean default true,
  p_season_custom_ends_at timestamptz default null,
  p_resolution_window_hours numeric default 8,
  p_require_endorsement boolean default true,
  p_join_message text default null,
  p_awards_enabled boolean default true,
  p_prize_text text default null,
  p_punishment_text text default null
) returns group_settings
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_group groups%rowtype;
  v_settings group_settings%rowtype;
  v_was_betting_enabled boolean;
  v_ends_at timestamptz;
  v_join_message text;
  v_prize_text text;
  v_punishment_text text;
begin
  select * into v_group from groups where id = p_group_id;
  if v_group.id is null then
    raise exception 'not_found: group not found';
  end if;

  if v_group.is_public then
    if v_caller <> v_group.owner_id then
      perform 1 from memberships where group_id = p_group_id and user_id = v_caller and status <> 'removed';
      if not found then
        raise exception 'not_found: group not found';
      end if;
    end if;
    if not _is_group_mod_or_owner(p_group_id, v_caller) then
      raise exception 'forbidden: only the owner or a moderator can edit settings';
    end if;
  else
    perform 1 from memberships where group_id = p_group_id and user_id = v_caller and status <> 'removed';
    if not found then
      raise exception 'not_found: group not found';
    end if;
    if v_caller <> v_group.owner_id then
      raise exception 'forbidden: only the group owner can edit settings';
    end if;
  end if;

  if v_group.is_public then
    p_seasons_enabled := false;
    p_season_length := null;
    p_allow_hedged_bets := false;
    p_require_endorsement := false;
    p_accepting_members := true;
    p_betting_enabled := true;
    p_awards_enabled := false;
    p_distribute_payout := true;
    p_creator_payout_pct := 0;
    p_prize_text := null;
    p_punishment_text := null;
  end if;

  if not exists (select 1 from pg_timezone_names where name = p_timezone) then
    raise exception 'invalid_operation: unrecognized time zone';
  end if;

  if p_creator_payout_pct < 0 or p_creator_payout_pct > 100 then
    raise exception 'invalid_operation: the creator percentage must be between 0 and 100';
  end if;

  if p_resolution_window_hours < 0.5 or p_resolution_window_hours > 10 then
    raise exception 'invalid_operation: the challenge/resolution window must be between 0.5 and 10 hours';
  end if;
  if p_resolution_window_hours * 2 <> floor(p_resolution_window_hours * 2) then
    raise exception 'invalid_operation: the challenge/resolution window must be in half-hour steps';
  end if;

  if p_seasons_enabled and p_season_length = 'custom' and (p_season_custom_ends_at is null or p_season_custom_ends_at <= now()) then
    raise exception 'invalid_operation: pick a custom season end date in the future';
  end if;

  v_join_message := nullif(trim(coalesce(p_join_message, '')), '');
  if v_join_message is not null and length(v_join_message) > 240 then
    raise exception 'invalid_operation: the join message must be 240 characters or fewer';
  end if;

  v_prize_text := nullif(trim(coalesce(p_prize_text, '')), '');
  if v_prize_text is not null and length(v_prize_text) > 120 then
    raise exception 'invalid_operation: the prize must be 120 characters or fewer';
  end if;

  v_punishment_text := nullif(trim(coalesce(p_punishment_text, '')), '');
  if v_punishment_text is not null and length(v_punishment_text) > 120 then
    raise exception 'invalid_operation: the punishment must be 120 characters or fewer';
  end if;

  select * into v_settings from group_settings where group_id = p_group_id;
  v_was_betting_enabled := v_settings.betting_enabled;

  if p_seed_amount is distinct from v_settings.seed_amount
     and (p_seed_amount is null or p_seed_amount < 1 or p_seed_amount > 1000000) then
    raise exception 'invalid_operation: the token allocation must be between 1 and 1,000,000';
  end if;

  if v_settings.seasons_enabled and not p_seasons_enabled then
    raise exception 'invalid_operation: seasons cannot be turned off once enabled';
  end if;

  if v_was_betting_enabled and not p_betting_enabled then
    raise exception 'invalid_operation: betting cannot be turned off once enabled, end the season instead to pause things';
  end if;

  update group_settings
  set seed_amount = p_seed_amount,
      seasons_enabled = p_seasons_enabled,
      season_length = p_season_length,
      timezone = p_timezone,
      betting_enabled = p_betting_enabled,
      accepting_members = p_accepting_members,
      distribute_payout = p_distribute_payout,
      creator_payout_pct = p_creator_payout_pct,
      allow_hedged_bets = p_allow_hedged_bets,
      season_custom_ends_at = p_season_custom_ends_at,
      resolution_window_hours = p_resolution_window_hours,
      require_endorsement = p_require_endorsement,
      join_message = v_join_message,
      awards_enabled = p_awards_enabled,
      prize_text = v_prize_text,
      punishment_text = v_punishment_text
  where group_id = p_group_id
  returning * into v_settings;

  if p_seasons_enabled and not exists (select 1 from seasons where group_id = p_group_id) then
    v_ends_at := _compute_season_ends_at(p_season_length, p_season_custom_ends_at, now());
    insert into seasons (group_id, number, status, seed_amount, ends_at, season_length, betting_open)
    values (p_group_id, 1, 'active', p_seed_amount, v_ends_at, p_season_length, p_betting_enabled);
  end if;

  if p_betting_enabled and not v_was_betting_enabled then
    perform _emit_notification_event('betting_opened', p_group_id, null, null, v_caller);
  end if;

  return v_settings;
end;
$$;

revoke execute on function update_group_settings(uuid, int, boolean, season_length, text, boolean, boolean, boolean, int, boolean, timestamptz, numeric, boolean, text, boolean, text, text) from public;
grant execute on function update_group_settings(uuid, int, boolean, season_length, text, boolean, boolean, boolean, int, boolean, timestamptz, numeric, boolean, text, boolean, text, text) to authenticated;

-- _finalize_season() gets a `loser` key mirroring `champion` (lowest balance instead of highest,
-- same user_id tiebreak) plus prize_text/punishment_text copied from group_settings at finalize
-- time -- frozen into the snapshot rather than read live later, same reasoning as titles_snapshot:
-- if the owner changes the text after the season ends, past recaps shouldn't silently rewrite
-- themselves. Same signature as 20260823140000, plain create or replace.
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
    'loser', (
      select jsonb_build_object('user_id', m.user_id, 'nickname', m.nickname, 'balance', m.balance)
      from memberships m
      where m.group_id = v_season.group_id and m.status <> 'removed'
      order by m.balance asc, m.user_id
      limit 1
    ),
    'prize_text', (select gs.prize_text from group_settings gs where gs.group_id = v_season.group_id),
    'punishment_text', (select gs.punishment_text from group_settings gs where gs.group_id = v_season.group_id),
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
      where m.group_id = v_season.group_id and l.reason = 'payout' and l.created_at >= v_season.started_at
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
