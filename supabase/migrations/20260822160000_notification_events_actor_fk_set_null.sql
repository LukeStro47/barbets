-- notification_events.actor_id had no ON DELETE behavior, which defaults to
-- Postgres's NO ACTION: it silently blocked deleting a user's account if any
-- notification_events row still referenced them as the actor, however old.
-- This is a real bug, not a test-only annoyance — public.users.id references
-- auth.users(id) on delete cascade, so deleteAccount()'s call to
-- admin.auth.admin.deleteUser() cascades into public.users, and that cascade
-- was getting blocked by this FK the moment it reached notification_events.
-- Anyone who had ever sponsored a market, proposed a resolution, or
-- challenged one (any action that sets actor_id) within the 30-day
-- notification_events retention window could not delete their account, and
-- would have seen only a generic "failed to delete" error with no hint why.
--
-- The integration suite's own cleanupTestUsers() hit this too, but silently
-- swallows the error (console.error, never thrown) rather than failing the
-- test — which is why this went unnoticed rather than showing up as a
-- test failure pointing straight at it.
--
-- on delete set null is the right fix, not on delete cascade: a notification
-- event is a historical record that something happened, and it doesn't need
-- its acting user's account to keep existing. get_event_recipients() already
-- treats a null actor_id as "nobody to exclude" — the same as a
-- cron-triggered event — so this is a real, already-handled case, not a new
-- code path. Postgres has no ALTER CONSTRAINT for changing a foreign key's ON
-- DELETE behavior in place, so the constraint is dropped and recreated.
alter table notification_events drop constraint notification_events_actor_id_fkey;
alter table notification_events add constraint notification_events_actor_id_fkey
  foreign key (actor_id) references users (id) on delete set null;
