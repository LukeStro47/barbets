create or replace function _debug_get_fn_def(p_name text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select pg_get_functiondef(p_name::regprocedure);
$$;

revoke execute on function _debug_get_fn_def(text) from public;
grant execute on function _debug_get_fn_def(text) to service_role;
