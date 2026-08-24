-- Public groups: a handful of always-on, staff-owned groups anyone can browse and instantly join,
-- so a brand-new user can try Barbets before they've talked a single friend into creating a real
-- group. This migration lays down the schema only — the join/browse/gating functions follow in
-- later migrations today.
--
-- groups.is_public / groups.category: a public group is still owned via the existing
-- groups.owner_id (Barbets staff holds it), so this is additive, not a new parallel model.
-- category is null for an ordinary private group; 'generic' for an auto-populated
-- sports/weather group, 'campus' for a school-specific one (WVU, Rutgers, ...). The check
-- constraint ties the two together so a private group can never carry a category and a public
-- one can never lack one.
alter table groups add column is_public boolean not null default false;
alter table groups add column category text;
alter table groups add constraint groups_public_category_consistency check (
  (is_public = false and category is null)
  or (is_public = true and category in ('generic', 'campus'))
);

-- memberships.role: the first multi-person-per-group authority tier in this codebase. Deliberately
-- not a third value alongside owner here — groups.owner_id remains the single source of truth for
-- "who owns this group" (transfer_ownership() already manages it, and duplicating ownership into a
-- role column would just be two places that could drift). 'moderator' is a scoped subset of owner
-- power (create a market by hand, void a bad auto-generated one, manage the group day to day);
-- 'member' is the default and covers every existing group unchanged.
alter table memberships add column role text not null default 'member' check (role in ('member', 'moderator'));

-- group_settings.awards_enabled: off for every public group (no built-in titles, no custom
-- awards — see the design note on why: a large, mostly-stranger public roster makes a permanent
-- "you're the group's worst bettor" badge a very different experience than it is in a group of
-- friends). Same pattern as betting_enabled/accepting_members: a plain settings flag, default true
-- so every existing private group is unaffected.
alter table group_settings add column awards_enabled boolean not null default true;

-- The one choke point every mod-gated function calls: true for the group's owner (unchanged
-- authority) or an active/dormant member whose role is 'moderator'. A 'left'/'removed' member's
-- role is irrelevant — they're gated out by status the same way ownership already is elsewhere.
create function _is_group_mod_or_owner(p_group_id uuid, p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from groups g
    where g.id = p_group_id and g.owner_id = p_user_id
  ) or exists (
    select 1 from memberships m
    where m.group_id = p_group_id and m.user_id = p_user_id
      and m.role = 'moderator' and m.status in ('active', 'dormant')
  );
$$;

revoke execute on function _is_group_mod_or_owner(uuid, uuid) from public;
grant execute on function _is_group_mod_or_owner(uuid, uuid) to authenticated;
