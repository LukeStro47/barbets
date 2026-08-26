-- Critical fix: every function in `public` currently has standing anon EXECUTE, not just the two
-- meant to (invite_code_exists, log_qr_scan). 20260814120000 fixed this for exactly the two
-- functions it named (get_group_by_invite_code, join_group) and documented the general cause
-- (Supabase's bootstrap auto-grants anon on every function the instant it's created, a separate
-- grant from PUBLIC that `revoke ... from public` never touches), but nothing enforced the fix
-- going forward -- every function created since (the whole public-groups feature, awards, seasons,
-- pipelines, this migration's own _debug_anon_grants included) got the same standing grant back.
-- Confirmed live via a temporary diagnostic function (20260828160000, dropped below): 109 of ~117
-- app-owned functions were anon-executable on the hosted project before this migration ran.
--
-- The real exposure isn't "anon can call these" by itself -- most gate on auth.uid(), which is
-- NULL for an anon caller, so the caller-identity check fails closed (not_found/forbidden) the
-- same way it would for a real signed-in stranger. It's that this was never supposed to be the
-- thing standing between an anonymous caller and this app's data; every function here was written
-- and reviewed on the assumption that only an authenticated Postgres role could reach it at all.
-- Any function that trusts a caller-supplied id (a p_user_id/p_membership_id argument) rather than
-- deriving identity from auth.uid() would have been a real, direct information disclosure to
-- anyone with nothing but the public anon key -- this migration closes that regardless of whether
-- any function actually has that shape today, rather than auditing 109 functions one at a time
-- under time pressure to find out.
--
-- Fixed with a loop instead of ~109 hand-written revoke lines, and deliberately not narrowed to
-- "only functions added since 20260814120000" -- rebuilding that boundary correctly is exactly the
-- kind of judgment call this bug already proved unreliable once.
do $$
declare
  r record;
begin
  for r in
    select p.oid
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and not exists (
        select 1 from pg_depend d
        where d.objid = p.oid and d.classid = 'pg_proc'::regclass and d.deptype = 'e'
      )
      and has_function_privilege('anon', p.oid, 'EXECUTE')
      and p.proname not in ('invite_code_exists', 'log_qr_scan')
  loop
    execute format('revoke execute on function %s from anon', r.oid::regprocedure);
  end loop;
end $$;
