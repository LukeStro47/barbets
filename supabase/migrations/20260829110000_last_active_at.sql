-- users.last_active_at, for WAU/MAU on the new admin analytics site.
-- Nullable, no default -- a row from before this migration reads NULL rather
-- than a fabricated now().
alter table users add column last_active_at timestamptz;

-- users has select and insert_own policies but deliberately no update policy
-- (see 20260707120800_identity.sql and the lesson re-learned in
-- 20260810161000_notification_preferences.sql's set_notifications_enabled
-- comment: a raw client `update users` silently matches zero rows under
-- RLS). So this has to be a SECURITY DEFINER function regardless.
--
-- Called once per request from the main app's authenticated layout
-- (app/(app)/layout.tsx), not from inside every mutation function -- a
-- page-load stamp also captures browse-only sessions that never touch a
-- mutation RPC, which is what "active" is supposed to mean for WAU/MAU.
--
-- Debounce lives in the WHERE clause rather than in application code: only
-- updates when the existing stamp is missing or more than 15 minutes old, so
-- reloading five pages in a minute produces one write, not five, and it's
-- safe to call unconditionally on every request -- worst case a cheap,
-- indexed no-op UPDATE that touches zero rows.
create function touch_last_active()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return;
  end if;

  update users set last_active_at = now()
  where id = auth.uid()
    and (last_active_at is null or last_active_at < now() - interval '15 minutes');
end;
$$;

revoke execute on function touch_last_active() from public;
grant execute on function touch_last_active() to authenticated;
