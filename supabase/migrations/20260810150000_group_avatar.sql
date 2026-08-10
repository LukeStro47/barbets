-- A group can pick one of the app's built-in avatars as its logo, replacing the
-- initials tile wherever the group is represented as a chip.
--
-- The column is deliberately plain text with only a shape check, not an enum or
-- a foreign key to a table of avatars: the art is static, ships in the Next.js
-- bundle under public/avatars/, and lib/avatars.ts is already the list that
-- decides what renders. Encoding the same list a second time in Postgres would
-- mean a migration every time a PNG is added or retired, and would make a
-- retired avatar an error rather than something that quietly falls back to the
-- initials tile (which is exactly what groupAvatarSrc() does with a key it
-- doesn't recognize).
alter table groups add column avatar_key text check (avatar_key ~ '^[a-z0-9-]{1,32}$');

create function set_group_avatar(p_group_id uuid, p_avatar_key text)
returns groups
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_group groups%rowtype;
  v_key text := nullif(trim(coalesce(p_avatar_key, '')), '');
begin
  select * into v_group from groups where id = p_group_id;
  if v_group.id is null then
    raise exception 'not_found: group not found';
  end if;

  -- Same 404-not-403 posture as every other group function: a non-member is
  -- told the group doesn't exist, and only a real member gets as far as the
  -- ownership check.
  perform 1 from memberships where group_id = p_group_id and user_id = v_caller and status <> 'removed';
  if not found then
    raise exception 'not_found: group not found';
  end if;

  if v_caller <> v_group.owner_id then
    raise exception 'forbidden: only the group owner can change the group logo';
  end if;

  if v_key is not null and v_key !~ '^[a-z0-9-]{1,32}$' then
    raise exception 'invalid_operation: that is not a valid logo';
  end if;

  update groups set avatar_key = v_key where id = p_group_id returning * into v_group;

  return v_group;
end;
$$;

revoke execute on function set_group_avatar(uuid, text) from public;
grant execute on function set_group_avatar(uuid, text) to authenticated;
