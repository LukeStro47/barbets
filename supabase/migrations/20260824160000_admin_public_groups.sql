-- Admin tooling for public groups, modeled on send_admin_broadcast() (20260805163000): a
-- SECURITY DEFINER function gated on is_platform_admin(), not the service-role client — creating a
-- group and flipping a role column are both ordinary writes that already go through
-- create_group()/plain UPDATEs for every other caller, just gated differently here.

-- create_public_group: the calling admin becomes the group's owner (and, like any create_group()
-- caller, its first seeded member) — "Barbets staff holds owner_id on these groups" from the
-- design doc means literally whichever admin's account created it, not a separate system user.
-- Forces is_public/category and awards_enabled = false at creation so a public group can never
-- momentarily exist without the rules that define it. Continuous (seasons off), betting on
-- immediately — a public group has no "owner sets things up first" period the way a private one
-- does.
create function create_public_group(
  p_name text,
  p_category text,
  p_seed_amount int,
  p_nickname text,
  p_timezone text default 'UTC'
) returns groups
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_group groups%rowtype;
  v_membership_id uuid;
  v_name text;
  v_nickname citext;
begin
  if not is_platform_admin(v_user_id) then
    raise exception 'forbidden: admin only';
  end if;

  v_name := nullif(trim(p_name), '');
  if v_name is null then
    raise exception 'invalid_operation: group name can''t be blank';
  end if;
  if length(v_name) > 60 then
    raise exception 'invalid_operation: group name must be 60 characters or fewer';
  end if;

  if p_category not in ('generic', 'campus') then
    raise exception 'invalid_operation: category must be generic or campus';
  end if;

  if p_seed_amount is null or p_seed_amount < 1 or p_seed_amount > 1000000 then
    raise exception 'invalid_operation: the token allocation must be between 1 and 1,000,000';
  end if;

  v_nickname := lower(trim(coalesce(p_nickname, '')))::citext;
  if v_nickname::text = '' then
    raise exception 'invalid_operation: choose a nickname to create a group with';
  end if;
  if v_nickname::text !~ '^[a-z0-9_]{1,20}$' then
    raise exception 'invalid_operation: nicknames can only use lowercase letters, numbers, and underscores, up to 20 characters';
  end if;

  if not exists (select 1 from pg_timezone_names where name = p_timezone) then
    raise exception 'invalid_operation: unrecognized time zone';
  end if;

  -- _generate_invite_code() already guarantees uniqueness internally (its own
  -- collision-retry loop), same as every other create_group()-shaped insert.
  insert into groups (name, owner_id, invite_code, is_public, category)
  values (v_name, v_user_id, _generate_invite_code(), true, p_category)
  returning * into v_group;

  insert into group_settings (group_id, seed_amount, seasons_enabled, timezone, betting_enabled, awards_enabled)
  values (v_group.id, p_seed_amount, false, p_timezone, true, false);

  insert into memberships (group_id, user_id, balance, status, nickname)
  values (v_group.id, v_user_id, p_seed_amount, 'active', v_nickname)
  returning id into v_membership_id;

  insert into ledger (membership_id, amount, reason)
  values (v_membership_id, p_seed_amount, 'seed');

  return v_group;
end;
$$;

revoke execute on function create_public_group(text, text, int, text, text) from public;
grant execute on function create_public_group(text, text, int, text, text) to authenticated;

-- assign_group_moderator: scoped to public groups only. A private group already has a single
-- owner with full authority; the moderator tier exists specifically so Barbets staff don't have to
-- personally handle every public group's day-to-day (creating a market by hand, voiding a bad
-- auto-generated one) themselves.
create function assign_group_moderator(
  p_group_id uuid,
  p_target_user_id uuid,
  p_is_moderator boolean
) returns memberships
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row memberships%rowtype;
begin
  if not is_platform_admin() then
    raise exception 'forbidden: admin only';
  end if;

  perform 1 from groups where id = p_group_id and is_public = true;
  if not found then
    raise exception 'not_found: group not found';
  end if;

  update memberships
  set role = case when p_is_moderator then 'moderator' else 'member' end
  where group_id = p_group_id and user_id = p_target_user_id and status in ('active', 'dormant')
  returning * into v_row;

  if v_row.id is null then
    raise exception 'not_found: not an active member of this group';
  end if;

  return v_row;
end;
$$;

revoke execute on function assign_group_moderator(uuid, uuid, boolean) from public;
grant execute on function assign_group_moderator(uuid, uuid, boolean) to authenticated;

-- list_group_moderator_candidates: the picker behind assignGroupModerator() in the admin UI —
-- every active/dormant member of a public group plus their current role, so the admin can see who
-- already mods it before flipping anyone.
create function list_group_moderator_candidates(p_group_id uuid)
returns table (user_id uuid, nickname text, role text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not is_platform_admin() then
    raise exception 'forbidden: admin only';
  end if;

  perform 1 from groups where id = p_group_id and is_public = true;
  if not found then
    raise exception 'not_found: group not found';
  end if;

  return query
  select m.user_id, m.nickname::text, m.role
  from memberships m
  where m.group_id = p_group_id and m.status in ('active', 'dormant')
  order by m.nickname;
end;
$$;

revoke execute on function list_group_moderator_candidates(uuid) from public;
grant execute on function list_group_moderator_candidates(uuid) to authenticated;
