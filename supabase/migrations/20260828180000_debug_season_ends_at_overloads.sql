-- Diagnostic only, dropped alongside _debug_anon_grants once the anon-revoke audit is clean.
create function _debug_fn_overloads(p_name text)
returns table (oid_text text, identity_args text, anon_execute boolean)
language sql
stable
security definer
set search_path = public
as $$
  select p.oid::text, pg_get_function_identity_arguments(p.oid), has_function_privilege('anon', p.oid, 'EXECUTE')
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = p_name;
$$;

revoke execute on function _debug_fn_overloads(text) from public;
grant execute on function _debug_fn_overloads(text) to service_role;
