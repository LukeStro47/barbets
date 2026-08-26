-- Signup is the one lifecycle moment that isn't already a SECURITY DEFINER
-- mutation function -- ensureProfileRow() in lib/actions/auth.ts is a direct
-- client-side upsert into users (allowed by the users_insert_own RLS
-- policy), called from both the immediate-session signup path and the
-- confirmSignup (OTP) path, and also on every plain sign-in as a harmless
-- no-op. Guarded idempotent here (not just called once) so it's safe to call
-- from both signup paths without risking a double-counted signup event.
create function record_signup()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not_found: unauthenticated';
  end if;

  insert into lifecycle_events (event_type, user_id)
  select 'signup', auth.uid()
  where not exists (
    select 1 from lifecycle_events where event_type = 'signup' and user_id = auth.uid()
  );
end;
$$;

revoke execute on function record_signup() from public;
grant execute on function record_signup() to authenticated;
