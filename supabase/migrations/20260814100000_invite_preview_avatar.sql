-- get_group_by_invite_code() previously withheld the group's avatar_key, so
-- the /join screen could only ever show the initials monogram even for a
-- group with a real avatar picked. avatar_key isn't sensitive: it's one of
-- the fixed, app-authored icons in lib/avatars.ts, identical for every group
-- and never user-supplied, so there's no privacy reason to hide it from a
-- non-member. Same signature, dropped and recreated because the return shape
-- changes.
drop function if exists get_group_by_invite_code(text);

create function get_group_by_invite_code(p_invite_code text)
returns table (id uuid, name text, avatar_key text, accepting_members boolean, my_status text)
language plpgsql
security definer
set search_path = public
as $$
begin
  perform _enforce_invite_code_rate_limit();

  return query
    select
      g.id,
      g.name,
      g.avatar_key,
      gs.accepting_members,
      (select m.status::text from memberships m where m.group_id = g.id and m.user_id = auth.uid())
    from groups g
    join group_settings gs on gs.group_id = g.id
    where g.invite_code = p_invite_code::citext;

  -- FOUND is false when the RETURN QUERY above produced no rows: a guess.
  if not found then
    perform _record_invite_code_miss();
  end if;
end;
$$;

revoke execute on function get_group_by_invite_code(text) from public;
grant execute on function get_group_by_invite_code(text) to authenticated;
