-- Diagnostic only, dropped in the immediately following migration once confirmed clean.
create function _debug_anon_grants()
returns table (proname text, args text)
language sql
stable
security definer
set search_path = public
as $$
  select p.proname, pg_get_function_identity_arguments(p.oid)
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and not exists (
      select 1 from pg_depend d
      where d.objid = p.oid and d.classid = 'pg_proc'::regclass and d.deptype = 'e'
    )
    and has_function_privilege('anon', p.oid, 'EXECUTE');
$$;

revoke execute on function _debug_anon_grants() from public;
revoke execute on function _debug_anon_grants() from anon;
grant execute on function _debug_anon_grants() to service_role;
