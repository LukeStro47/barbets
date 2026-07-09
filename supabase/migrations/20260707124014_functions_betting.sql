-- place_bet: locks the market row (serializes against expire_stale()
-- concurrently closing it) and the bettor's own membership row (the actual
-- money-safety lock). Cap is computed from the active season's snapshot
-- bet_cap_pct when seasons are enabled (so a mid-season settings edit can't
-- retroactively change anyone's cap), or live group_settings when seasons
-- are off. Minimum bet is always 1, even if the % cap would floor to 0, as
-- long as the bettor isn't flat broke.
create or replace function place_bet(p_market_id uuid, p_side bet_side, p_amount int)
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

  if v_market.status <> 'open' or v_market.closes_at <= now() then
    raise exception 'invalid_operation: betting is not open on this market';
  end if;

  if (v_market.market_type = 'yes_no' and p_side not in ('yes', 'no'))
     or (v_market.market_type = 'over_under' and p_side not in ('over', 'under')) then
    raise exception 'invalid_operation: side does not match market type';
  end if;

  select coalesce(s.bet_cap_pct, gs.bet_cap_pct) into v_cap_pct
  from group_settings gs
  left join seasons s on s.id = v_market.season_id
  where gs.group_id = v_market.group_id;

  select * into v_membership
  from memberships
  where group_id = v_market.group_id and user_id = v_user_id
  for update;

  if v_membership.id is null or v_membership.status = 'removed' then
    raise exception 'not_found: not a member of this group';
  end if;

  if v_membership.status = 'dormant' then
    raise exception 'invalid_operation: dormant members cannot bet — opt in to the current season first';
  end if;

  if v_membership.balance < 1 then
    raise exception 'insufficient_balance: you have no tokens to bet';
  end if;

  v_max_bet := greatest(1, floor(v_membership.balance * v_cap_pct / 100.0)::int);
  if v_max_bet > v_membership.balance then
    v_max_bet := v_membership.balance;
  end if;

  if p_amount < 1 or p_amount > v_max_bet then
    raise exception 'invalid_operation: amount must be between 1 and your current cap of %', v_max_bet;
  end if;

  insert into bets (market_id, user_id, side, amount)
  values (p_market_id, v_user_id, p_side, p_amount)
  returning * into v_bet;

  update memberships set balance = balance - p_amount where id = v_membership.id;

  insert into ledger (membership_id, amount, reason, market_id, bet_id)
  values (v_membership.id, -p_amount, 'bet', p_market_id, v_bet.id);

  return v_bet;
end;
$$;

revoke execute on function place_bet(uuid, bet_side, int) from public;
grant execute on function place_bet(uuid, bet_side, int) to authenticated;

-- get_open_bet_count: the sealed-market "🤫 N bets placed" figure — a raw
-- count, no amounts, sides, or names. Bypasses bets' own RLS (which while a
-- market is open only shows a member their own bets) since this needs the
-- true total; is_market_visible() re-establishes the same subject exclusion
-- that bets' RLS would otherwise provide.
create or replace function get_open_bet_count(p_market_id uuid)
returns bigint
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_count bigint;
begin
  if not is_market_visible(p_market_id) then
    raise exception 'not_found: market not found';
  end if;

  select count(*) into v_count from bets where market_id = p_market_id;
  return v_count;
end;
$$;

revoke execute on function get_open_bet_count(uuid) from public;
grant execute on function get_open_bet_count(uuid) to authenticated;

-- get_closed_odds: pool percentages + counts per side, only once betting
-- has actually closed (is_market_visible alone isn't enough here — a
-- non-subject member can see an 'open' market just fine, but odds must stay
-- hidden until it's at least 'closed'). Always returns a row for every
-- valid side of the market, even a side with zero bets, so the UI never has
-- to special-case a missing row.
create or replace function get_closed_odds(p_market_id uuid)
returns table (side bet_side, pool_amount bigint, bet_count bigint, pool_percent numeric)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_market markets%rowtype;
  v_total bigint;
  v_sides bet_side[];
begin
  if not is_market_visible(p_market_id) then
    raise exception 'not_found: market not found';
  end if;

  select * into v_market from markets where id = p_market_id;

  if v_market.status in ('pending_sponsor', 'open') then
    raise exception 'invalid_operation: odds are not available until betting closes';
  end if;

  v_sides := case v_market.market_type
    when 'yes_no' then array['yes', 'no']::bet_side[]
    else array['over', 'under']::bet_side[]
  end;

  select coalesce(sum(b.amount), 0) into v_total from bets b where b.market_id = p_market_id;

  return query
  select
    s as side,
    coalesce(sum(b.amount), 0)::bigint as pool_amount,
    count(b.id) as bet_count,
    case when v_total = 0 then 0
         else round(coalesce(sum(b.amount), 0)::numeric * 100 / v_total, 1)
    end as pool_percent
  from unnest(v_sides) as s
  left join bets b on b.market_id = p_market_id and b.side = s
  group by s
  order by s;
end;
$$;

revoke execute on function get_closed_odds(uuid) from public;
grant execute on function get_closed_odds(uuid) to authenticated;
