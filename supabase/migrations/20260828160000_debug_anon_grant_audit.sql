-- Diagnostic only, dropped in the immediately following migration. Same pattern as
-- 20260826111000/20260826113000 (_debug_get_fn_def): a temporary service_role-only helper to run
-- the anon-grant audit query from ARCHITECTURE.md's "notable design decisions" against the live
-- project, since PostgREST has no raw-SQL endpoint to run it through directly.
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
grant execute on function _debug_anon_grants() to service_role;
