-- The /join/[code] page needs to tell a blocked visitor why *before* it
-- offers to join them (removed, or the group has closed new membership) —
-- previously it only found out via a join_group() error after they'd
-- already filled in a nickname and clicked through. get_group_by_invite_code
-- already bypasses RLS to preview the group name for a non-member; extend it
-- to also reveal accepting_members and the caller's own membership status
-- (null if never a member). Changing the return shape isn't a valid
-- CREATE OR REPLACE, so the old 2-column signature is dropped first.
drop function if exists get_group_by_invite_code(text);

create function get_group_by_invite_code(p_invite_code text)
returns table (id uuid, name text, accepting_members boolean, my_status text)
language sql
stable
security definer
set search_path = public
as $$
  select
    g.id,
    g.name,
    gs.accepting_members,
    (select m.status::text from memberships m where m.group_id = g.id and m.user_id = auth.uid())
  from groups g
  join group_settings gs on gs.group_id = g.id
  where g.invite_code = p_invite_code::citext;
$$;

revoke execute on function get_group_by_invite_code(text) from public;
grant execute on function get_group_by_invite_code(text) to authenticated;
