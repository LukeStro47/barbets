-- Corrects two regressions introduced by 20260708112000's rewrite of
-- create_market()/place_bet(), caught by the existing test suite:
--
-- 1. create_market()'s subject-cap threshold used `>= v_member_count - 2`
-- in both branches — that's the ORIGINAL off-by-one bug that
-- 20260707210000_fix_subject_cap_off_by_one.sql already fixed to
-- `>= v_member_count - 1` (cap allows *up to* member_count - 2 subjects;
-- only member_count - 1 or more gets rejected). The rewrite was based on an
-- earlier snapshot of the function and clobbered that fix.
--
-- 2. place_bet()'s check order regressed behind
-- 20260707133033_fix_eligibility_check_ordering.sql, which moved the
-- membership check ahead of the market-status check specifically so a
-- complete stranger (not even a member of the group) gets 'not_found'
-- rather than learning the market's lifecycle state ("betting is not open")
-- before ever being told they have no business here. The rewrite put the
-- status check back in front.
create or replace function create_market(
  p_group_id uuid,
  p_title text,
  p_description text,
  p_market_type market_type,
  p_closes_at timestamptz,
  p_line numeric default null,
  p_subject_user_ids uuid[] default '{}',
  p_options text[] default null,
  p_option_subjects jsonb default '[]'::jsonb
) returns markets
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_settings group_settings%rowtype;
  v_season_id uuid;
  v_member_count int;
  v_subject_ids uuid[];
  v_invalid_subject_count int;
  v_market markets%rowtype;
  v_option_count int;
  v_option_id uuid;
  v_opt_subjects uuid[];
  v_all_subject_ids uuid[];
  v_all_subject_total int;
  v_idx int;
begin
  perform 1 from memberships where group_id = p_group_id and user_id = v_user_id and status <> 'removed';
  if not found then
    raise exception 'not_found: not a member of this group';
  end if;

  if p_closes_at <= now() then
    raise exception 'invalid_operation: closes_at must be in the future';
  end if;

  select * into v_settings from group_settings where group_id = p_group_id;
  if v_settings.seasons_enabled then
    select id into v_season_id from seasons where group_id = p_group_id and status = 'active';
    if v_season_id is null then
      raise exception 'invalid_operation: the group is between seasons — wait for the new season to start';
    end if;
  end if;

  select count(*) into v_member_count from memberships where group_id = p_group_id and status <> 'removed';

  if p_market_type = 'multiple_choice' then
    v_option_count := coalesce(array_length(p_options, 1), 0);
    if v_option_count < 2 or v_option_count > 10 then
      raise exception 'invalid_operation: multiple choice markets need between 2 and 10 options';
    end if;

    if exists (select 1 from unnest(p_options) as o where trim(o) = '') then
      raise exception 'invalid_operation: option labels cannot be blank';
    end if;

    if (select count(distinct trim(o)) from unnest(p_options) as o) <> v_option_count then
      raise exception 'invalid_operation: option labels must be unique';
    end if;

    v_all_subject_ids := '{}';
    v_all_subject_total := 0;
    for v_idx in 1 .. v_option_count loop
      if p_option_subjects is not null and jsonb_array_length(p_option_subjects) >= v_idx then
        select array_agg(x::uuid) into v_opt_subjects
        from jsonb_array_elements_text(p_option_subjects -> (v_idx - 1)) as x;
      else
        v_opt_subjects := null;
      end if;

      if v_opt_subjects is not null then
        v_all_subject_total := v_all_subject_total + array_length(v_opt_subjects, 1);
        v_all_subject_ids := v_all_subject_ids || v_opt_subjects;
      end if;
    end loop;

    select array_agg(distinct x) into v_all_subject_ids from unnest(v_all_subject_ids) as x;

    if v_all_subject_ids is not null then
      if v_all_subject_total <> array_length(v_all_subject_ids, 1) then
        raise exception 'invalid_operation: a member can only be a subject of one option';
      end if;

      if v_user_id = any(v_all_subject_ids) then
        raise exception 'invalid_operation: the creator cannot be a subject of their own market';
      end if;

      if array_length(v_all_subject_ids, 1) >= v_member_count - 1 then
        raise exception 'invalid_operation: this group has % members, so a market can have at most % subject(s) — enough people need to be left to create, endorse, and bet on it', v_member_count, greatest(v_member_count - 2, 0);
      end if;

      select count(*) into v_invalid_subject_count
      from unnest(v_all_subject_ids) as x
      where not exists (
        select 1 from memberships where group_id = p_group_id and user_id = x and status = 'active'
      );
      if v_invalid_subject_count > 0 then
        raise exception 'invalid_operation: all subjects must be active members of the group';
      end if;
    end if;

    insert into markets (group_id, season_id, title, description, market_type, line, creator_id, closes_at)
    values (p_group_id, v_season_id, p_title, p_description, p_market_type, null, v_user_id, p_closes_at)
    returning * into v_market;

    for v_idx in 1 .. v_option_count loop
      insert into market_options (market_id, label, sort_order)
      values (v_market.id, trim(p_options[v_idx]), v_idx)
      returning id into v_option_id;

      if p_option_subjects is not null and jsonb_array_length(p_option_subjects) >= v_idx then
        insert into market_subjects (market_id, user_id, option_id)
        select v_market.id, x::uuid, v_option_id
        from jsonb_array_elements_text(p_option_subjects -> (v_idx - 1)) as x;
      end if;
    end loop;
  else
    select array_agg(distinct x) into v_subject_ids from unnest(p_subject_user_ids) as x;

    if v_subject_ids is not null and v_user_id = any(v_subject_ids) then
      raise exception 'invalid_operation: the creator cannot be a subject of their own market';
    end if;

    if v_subject_ids is not null then
      if array_length(v_subject_ids, 1) >= v_member_count - 1 then
        raise exception 'invalid_operation: this group has % members, so a market can have at most % subject(s) — enough people need to be left to create, endorse, and bet on it', v_member_count, greatest(v_member_count - 2, 0);
      end if;

      select count(*) into v_invalid_subject_count
      from unnest(v_subject_ids) as x
      where not exists (
        select 1 from memberships where group_id = p_group_id and user_id = x and status = 'active'
      );
      if v_invalid_subject_count > 0 then
        raise exception 'invalid_operation: all subjects must be active members of the group';
      end if;
    end if;

    insert into markets (group_id, season_id, title, description, market_type, line, creator_id, closes_at)
    values (p_group_id, v_season_id, p_title, p_description, p_market_type, p_line, v_user_id, p_closes_at)
    returning * into v_market;

    if v_subject_ids is not null then
      insert into market_subjects (market_id, user_id)
      select v_market.id, x from unnest(v_subject_ids) as x;
    end if;
  end if;

  perform _emit_notification_event('market_needs_endorsement', p_group_id, v_market.id, null, v_user_id);

  return v_market;
end;
$$;

revoke execute on function create_market(uuid, text, text, market_type, timestamptz, numeric, uuid[], text[], jsonb) from public;
grant execute on function create_market(uuid, text, text, market_type, timestamptz, numeric, uuid[], text[], jsonb) to authenticated;

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
    raise exception 'invalid_operation: dormant members cannot bet — opt in to the current season first';
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
