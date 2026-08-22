-- Lets a user upload their own profile picture instead of only ever being
-- represented by initials. A public Storage bucket, not the private
-- resolution-proofs pattern: an avatar renders in bulk everywhere a nickname
-- does (leaderboard rows, and eventually every @mention), and the 60-second
-- signed URL that pattern uses for one proof photo doesn't work at that
-- scale. Group logos sidestep this entirely by bypassing Storage altogether
-- (they're app-authored, identical for every group, never user-supplied) —
-- an avatar genuinely is user-supplied, so this is a real new precedent, not
-- a copy of either existing pattern.
--
-- No storage.objects RLS policies, same zero-policy posture as every other
-- bucket here: a public bucket's object endpoint bypasses policy checks
-- entirely for reads, and writes only ever go through the service-role
-- client inside uploadAvatar()'s Server Action, never directly from the
-- client.
--
-- There is no image moderation anywhere in this codebase, and a public
-- avatar is visible to the whole group with no review step. That is a
-- deliberate, accepted risk consistent with this app's existing trust model
-- (nicknames aren't verified either), not an oversight — see ARCHITECTURE.md.
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

-- avatar_updated_at alone is enough to represent "has an avatar or not," and
-- it doubles as the cache-busting query param on the rendered URL. The
-- object path itself is always deterministic (`{user_id}.jpg`, upserted on
-- every re-upload), so there's no separate path column to keep in sync with
-- it — unlike groups.avatar_key, which has to store a value because it picks
-- between several different static assets rather than always meaning "the
-- one object at this user's own path."
alter table users add column avatar_updated_at timestamptz;

-- Writes only the caller's own row, same reasoning as set_notifications_enabled:
-- users has select and insert policies but deliberately no update policy, so a
-- plain `update users` would match zero rows and report success rather than
-- erroring.
create function set_avatar_uploaded(p_uploaded boolean)
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

  update users
  set avatar_updated_at = case when p_uploaded then now() else null end
  where id = auth.uid()
  returning * into v_user;

  return v_user;
end;
$$;

revoke execute on function set_avatar_uploaded(boolean) from public;
grant execute on function set_avatar_uploaded(boolean) to authenticated;
