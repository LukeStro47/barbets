-- Infrastructure for requiring an explicit re-accept of the Terms of use / Privacy policy after a
-- material change, instead of relying solely on the "continued use = you accept it" clause both
-- pages already carry. The version string itself lives in application code (lib/legal.ts), not
-- here — bumping it to trigger a reapproval is a plain code change, see ARCHITECTURE.md. This
-- column just remembers the last version each user actually agreed to.
alter table users add column accepted_policy_version text;
alter table users add column accepted_policy_at timestamptz;

-- Backfill: every existing account already agreed to what's live today (at signup, or under the
-- "continued use" clause), so stamp everyone at today's version rather than surfacing a
-- reapproval prompt for policies nobody has actually rewritten yet. Only a future bump to
-- CURRENT_POLICY_VERSION puts an existing user through the new gate. Keep this literal in sync
-- with lib/legal.ts's CURRENT_POLICY_VERSION as of this migration.
update users set accepted_policy_version = '2026-08-27', accepted_policy_at = now() where accepted_policy_version is null;

alter table users alter column accepted_policy_version set not null;

-- Own-row-only, same shape as the other users-table setters above. Takes the version as a
-- parameter rather than hardcoding it so Postgres never needs its own copy of the app's version
-- constant to keep in sync.
create function accept_current_policy(p_version text)
returns users
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user users%rowtype;
begin
  if auth.uid() is null then
    raise exception 'not_found: unauthenticated';
  end if;
  if p_version is null or length(trim(p_version)) = 0 then
    raise exception 'invalid_operation: missing policy version';
  end if;

  update users
  set accepted_policy_version = p_version,
      accepted_policy_at = now()
  where id = auth.uid()
  returning * into v_user;

  return v_user;
end;
$$;

revoke execute on function accept_current_policy(text) from public;
grant execute on function accept_current_policy(text) to authenticated;
