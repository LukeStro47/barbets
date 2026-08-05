-- get_subject_market_pulse's RETURNS TABLE declares an output column named `status`, which
-- PL/pgSQL treats as an implicit variable in scope for the whole function body — silently
-- shadowing the bare `status` reference in the membership check below and making it genuinely
-- ambiguous to Postgres ("could refer to either a PL/pgSQL variable or a table column", 42702),
-- not just to a human reader. Every other function in this codebase uses that same bare
-- `... and status <> 'removed'` idiom safely, only because none of them also return a column
-- called `status`. Fixed by table-qualifying it — the one thing this function needs that no
-- sibling function needed before.
create or replace function get_subject_market_pulse(p_market_id uuid)
returns table (status market_status, market_type market_type, closes_at timestamptz, bet_count bigint, pool_amount bigint)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_market markets%rowtype;
begin
  select * into v_market from markets where id = p_market_id;
  if v_market.id is null then
    raise exception 'not_found: market not found';
  end if;

  perform 1 from memberships where group_id = v_market.group_id and user_id = v_user_id and memberships.status <> 'removed';
  if not found then
    raise exception 'not_found: market not found';
  end if;

  if not exists (select 1 from market_subjects where market_id = p_market_id and user_id = v_user_id) then
    raise exception 'not_found: market not found';
  end if;

  if v_market.status in ('resolved', 'voided') then
    raise exception 'not_found: market not found';
  end if;

  return query
  select v_market.status, v_market.market_type, v_market.closes_at,
         count(b.id) as bet_count, coalesce(sum(b.amount), 0)::bigint as pool_amount
  from bets b
  where b.market_id = p_market_id;
end;
$$;

revoke execute on function get_subject_market_pulse(uuid) from public;
grant execute on function get_subject_market_pulse(uuid) to authenticated;
