-- No em dashes in user-facing copy, including friendly error messages
-- raised from SECURITY DEFINER functions (see ARCHITECTURE.md's copy
-- conventions note). create_market's em-dash copy was already fixed in the
-- multiple-choice simplification migration; this fixes the two remaining
-- live functions that still had one.
create or replace function place_bet(p_market_id uuid, p_side bet_side, p_amount int, p_option_id uuid default null)
returns bets
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_market markets%rowtype;
  v_cap_pct int;
  v_membership memberships%rowtype;
  v_max_bet int;
  v_bet bets%rowtype;
begin
  select * into v_market from markets where id = p_market_id for update;
  if v_market.id is null then
    raise exception 'not_found: market not found';
  end if;

  if exists (select 1 from market_subjects where market_id = p_market_id and user_id = v_user_id) then
    raise exception 'not_found: market not found';
  end if;

  select * into v_membership
  from memberships
  where group_id = v_market.group_id and user_id = v_user_id
  for update;

  if v_membership.id is null or v_membership.status = 'removed' then
    raise exception 'not_found: not a member of this group';
  end if;

  if v_market.status <> 'open' or v_market.closes_at <= now() then
    raise exception 'invalid_operation: betting is not open on this market';
  end if;

  if v_market.market_type = 'multiple_choice' then
    if p_side is not null then
      raise exception 'invalid_operation: side does not match market type';
    end if;
    if p_option_id is null then
      raise exception 'invalid_operation: choose an option to bet on';
    end if;
    perform 1 from market_options where id = p_option_id and market_id = p_market_id;
    if not found then
      raise exception 'invalid_operation: option does not belong to this market';
    end if;
  else
    if p_option_id is not null then
      raise exception 'invalid_operation: this market does not use options';
    end if;
    if (v_market.market_type = 'yes_no' and p_side not in ('yes', 'no'))
       or (v_market.market_type = 'over_under' and p_side not in ('over', 'under')) then
      raise exception 'invalid_operation: side does not match market type';
    end if;
  end if;

  if v_membership.status = 'dormant' then
    raise exception 'invalid_operation: dormant members cannot bet, opt in to the current season first';
  end if;

  if v_membership.balance < 1 then
    raise exception 'insufficient_balance: you have no tokens to bet';
  end if;

  select coalesce(s.bet_cap_pct, gs.bet_cap_pct) into v_cap_pct
  from group_settings gs
  left join seasons s on s.id = v_market.season_id
  where gs.group_id = v_market.group_id;

  v_max_bet := greatest(1, floor(v_membership.balance * v_cap_pct / 100.0)::int);
  if v_max_bet > v_membership.balance then
    v_max_bet := v_membership.balance;
  end if;

  if p_amount < 1 or p_amount > v_max_bet then
    raise exception 'invalid_operation: amount must be between 1 and your current cap of %', v_max_bet;
  end if;

  insert into bets (market_id, user_id, side, amount, option_id)
  values (p_market_id, v_user_id, p_side, p_amount, p_option_id)
  returning * into v_bet;

  update memberships set balance = balance - p_amount where id = v_membership.id;

  insert into ledger (membership_id, amount, reason, market_id, bet_id)
  values (v_membership.id, -p_amount, 'bet', p_market_id, v_bet.id);

  return v_bet;
end;
$$;

revoke execute on function place_bet(uuid, bet_side, int, uuid) from public;
grant execute on function place_bet(uuid, bet_side, int, uuid) to authenticated;

create or replace function start_season(p_group_id uuid)
returns seasons
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_group groups%rowtype;
  v_settings group_settings%rowtype;
  v_season seasons%rowtype;
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
    raise exception 'forbidden: only the group owner can start the season';
  end if;

  select * into v_settings from group_settings where group_id = p_group_id;

  select * into v_season from seasons where group_id = p_group_id and status = 'intermission' for update;
  if v_season.id is null then
    raise exception 'invalid_operation: no season is in intermission, end the current season first';
  end if;

  update seasons
  set status = 'active', started_at = now(),
      seed_amount = v_settings.seed_amount, bet_cap_pct = v_settings.bet_cap_pct
  where id = v_season.id
  returning * into v_season;

  for rec in
    select so.user_id
    from season_optins so
    join memberships m on m.group_id = p_group_id and m.user_id = so.user_id
    where so.season_id = v_season.id and m.status <> 'removed'
  loop
    update memberships
    set status = 'active', balance = v_season.seed_amount
    where group_id = p_group_id and user_id = rec.user_id;

    insert into ledger (membership_id, amount, reason)
    select id, v_season.seed_amount, 'seed'
    from memberships where group_id = p_group_id and user_id = rec.user_id;
  end loop;

  update memberships
  set status = 'dormant'
  where group_id = p_group_id
    and status <> 'removed'
    and user_id not in (select user_id from season_optins where season_id = v_season.id);

  return v_season;
end;
$$;

revoke execute on function start_season(uuid) from public;
grant execute on function start_season(uuid) to authenticated;
