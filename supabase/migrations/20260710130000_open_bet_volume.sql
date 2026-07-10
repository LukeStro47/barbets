-- get_open_bet_volume: the sealed-market total token volume, alongside
-- get_open_bet_count's raw bet count. Still no sides or names, just the sum
-- staked so far. A separate function rather than widening
-- get_open_bet_count's return shape, since changing an existing function's
-- return type isn't a valid CREATE OR REPLACE (same signature-identity rule
-- as every parameter change documented in ARCHITECTURE.md) and the two
-- figures are independently useful.
create or replace function get_open_bet_volume(p_market_id uuid)
returns bigint
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_volume bigint;
begin
  if not is_market_visible(p_market_id) then
    raise exception 'not_found: market not found';
  end if;

  select coalesce(sum(amount), 0) into v_volume from bets where market_id = p_market_id;
  return v_volume;
end;
$$;

revoke execute on function get_open_bet_volume(uuid) from public;
grant execute on function get_open_bet_volume(uuid) to authenticated;
