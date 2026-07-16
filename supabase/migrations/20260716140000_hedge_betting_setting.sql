-- Owner-configurable per-group setting to disallow hedged betting: betting big
-- on a heavy favorite and a token amount on the underdog to manufacture a
-- favorable risk profile regardless of outcome. Off by default is "hedging
-- allowed" (current behavior, no change for existing groups); when the owner
-- turns hedging off, a member can still top up their stake on the side/option
-- they already hold, just not add a bet on a different one. Freely
-- reversible either direction, unlike betting_enabled/seasons_enabled --
-- this only gates future place_bet calls, so there's no in-flight state
-- either direction could corrupt.
alter table group_settings add column allow_hedged_bets boolean not null default true;

-- Adding a trailing param changes the signature, so per the recurring
-- overload lesson in ARCHITECTURE.md the old 10-arg overload must be
-- dropped explicitly rather than left for CREATE OR REPLACE to orphan.
drop function if exists update_group_settings(uuid, int, boolean, season_length, text, boolean, boolean, boolean, int, int);

create or replace function update_group_settings(
  p_group_id uuid,
  p_seed_amount int,
  p_seasons_enabled boolean,
  p_season_length season_length default null,
  p_timezone text default 'UTC',
  p_betting_enabled boolean default false,
  p_accepting_members boolean default true,
  p_distribute_payout boolean default false,
  p_creator_payout_pct int default 25,
  p_endorser_payout_pct int default 5,
  p_allow_hedged_bets boolean default true
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
    raise exception 'forbidden: only the group owner can edit settings';
  end if;

  if not exists (select 1 from pg_timezone_names where name = p_timezone) then
    raise exception 'invalid_operation: unrecognized time zone';
  end if;

  if p_creator_payout_pct < 0 or p_creator_payout_pct > 100 or p_endorser_payout_pct < 0 or p_endorser_payout_pct > 100 then
    raise exception 'invalid_operation: payout percentages must be between 0 and 100';
  end if;
  if p_creator_payout_pct + p_endorser_payout_pct > 100 then
    raise exception 'invalid_operation: creator and endorser percentages cannot add up to more than 100';
  end if;

  select * into v_settings from group_settings where group_id = p_group_id;
  v_was_betting_enabled := v_settings.betting_enabled;

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
      endorser_payout_pct = p_endorser_payout_pct,
      allow_hedged_bets = p_allow_hedged_bets
  where group_id = p_group_id
  returning * into v_settings;

  if p_seasons_enabled and not exists (select 1 from seasons where group_id = p_group_id) then
    insert into seasons (group_id, number, status, seed_amount)
    values (p_group_id, 1, 'active', p_seed_amount);
  end if;

  if p_betting_enabled and not v_was_betting_enabled then
    perform _emit_notification_event('betting_opened', p_group_id, null, null, v_caller);
  end if;

  return v_settings;
end;
$$;

revoke execute on function update_group_settings(uuid, int, boolean, season_length, text, boolean, boolean, boolean, int, int, boolean) from public;
grant execute on function update_group_settings(uuid, int, boolean, season_length, text, boolean, boolean, boolean, int, int, boolean) to authenticated;

-- Same 4-param signature as before, so a plain CREATE OR REPLACE is safe
-- (no drop needed, same as how 20260714130000 replaced update_group_settings
-- without a signature change).
create or replace function place_bet(p_market_id uuid, p_side bet_side, p_amount int, p_option_id uuid default null)
returns bets
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_market markets%rowtype;
  v_membership memberships%rowtype;
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

  if not (select allow_hedged_bets from group_settings where group_id = v_market.group_id)
     and exists (
       select 1 from bets
       where market_id = p_market_id
         and user_id = v_user_id
         and (side is distinct from p_side or option_id is distinct from p_option_id)
     ) then
    raise exception 'invalid_operation: this group doesn''t allow betting on more than one side of a market, and you already have a bet on a different side here';
  end if;

  if v_membership.balance < 1 then
    raise exception 'insufficient_balance: you have no tokens to bet';
  end if;

  if p_amount < 1 or p_amount > v_membership.balance then
    raise exception 'invalid_operation: amount must be between 1 and your current balance of %', v_membership.balance;
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
