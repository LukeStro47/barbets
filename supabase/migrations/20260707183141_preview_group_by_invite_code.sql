-- Lets a non-member preview a group's name from an invite code before
-- joining (the /join/[code] deep link's confirmation screen). groups_select
-- requires membership, so a plain SELECT returns nothing for someone who
-- isn't in the group yet — this bypasses that narrowly, revealing only the
-- name, to anyone who already holds a valid invite code. Not the same risk
-- as broad enumeration: invite codes are unguessable, and this reveals
-- nothing about members, markets, or bets.
create or replace function get_group_by_invite_code(p_invite_code text)
returns table (id uuid, name text)
language sql
stable
security definer
set search_path = public
as $$
  select id, name from groups where invite_code = p_invite_code::citext;
$$;

revoke execute on function get_group_by_invite_code(text) from public;
grant execute on function get_group_by_invite_code(text) to authenticated;
