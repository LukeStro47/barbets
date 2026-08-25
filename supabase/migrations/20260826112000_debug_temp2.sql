create or replace function _debug_void_check(p_market_id uuid)
returns table (v_caller uuid, is_public boolean, mod_or_owner boolean, group_id uuid, owner_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_ uuid := auth.uid();
  v_market markets%rowtype;
  v_group groups%rowtype;
begin
  select * into v_market from markets where id = p_market_id;
  select * into v_group from groups where id = v_market.group_id;
  return query select v_caller_, v_group.is_public, _is_group_mod_or_owner(v_group.id, v_caller_), v_group.id, v_group.owner_id;
end;
$$;

revoke execute on function _debug_void_check(uuid) from public;
grant execute on function _debug_void_check(uuid) to authenticated;
