-- Lets a user pick one of the app's built-in avatars as their profile picture
-- instead of uploading a photo, reusing the exact same static art group logos
-- already use (lib/avatars.ts's GROUP_AVATARS, served from public/avatars/).
-- No new bucket, no new migration-maintained list: groupAvatarSrc()'s
-- "unknown key degrades to the initials tile" convention already covers a
-- retired icon here too.
--
-- A photo and a preset are mutually exclusive, not layered: picking a preset
-- means "I don't want a photo," so it clears avatar_updated_at, and
-- (re)uploading a photo clears avatar_preset_key right back. There's no
-- third "both are set" state to render a precedence rule for.
alter table users add column avatar_preset_key text check (avatar_preset_key ~ '^[a-z0-9-]{1,32}$');

create or replace function set_avatar_uploaded(p_uploaded boolean)
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
  set avatar_updated_at = case when p_uploaded then now() else null end,
      avatar_preset_key = case when p_uploaded then null else avatar_preset_key end
  where id = auth.uid()
  returning * into v_user;

  return v_user;
end;
$$;

-- Same "writes only the caller's own row" reasoning as set_avatar_uploaded: users has no update
-- policy of its own.
create function set_avatar_preset(p_avatar_key text)
returns users
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user users%rowtype;
  v_key text := nullif(trim(coalesce(p_avatar_key, '')), '');
begin
  if auth.uid() is null then
    raise exception 'not_found: unauthenticated';
  end if;

  if v_key is not null and v_key !~ '^[a-z0-9-]{1,32}$' then
    raise exception 'invalid_operation: that is not a valid avatar';
  end if;

  update users
  set avatar_preset_key = v_key,
      avatar_updated_at = null
  where id = auth.uid()
  returning * into v_user;

  return v_user;
end;
$$;

revoke execute on function set_avatar_preset(text) from public;
grant execute on function set_avatar_preset(text) to authenticated;
