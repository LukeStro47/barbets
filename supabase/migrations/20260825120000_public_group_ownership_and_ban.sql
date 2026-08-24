-- transfer_ownership: for a public group, the new owner must already be one of its moderators —
-- ownership stays inside the moderation team rather than passing to an arbitrary member. This is
-- what makes "hand it off" resolve cleanly either way: if another mod already exists, the owner
-- transfers straight to them and stays on as a regular moderator; if they're the only mod, the
-- transfer is rejected until they promote someone else first (via assign_group_moderator), which
-- the error message points at directly. Same 2-arg signature as
-- 20260709100000_group_admin_and_account_deletion.sql, plain CREATE OR REPLACE.
create or replace function transfer_ownership(p_group_id uuid, p_new_owner_id uuid)
returns groups
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_group groups%rowtype;
begin
  select * into v_group from groups where id = p_group_id;
  if v_group.id is null then
    raise exception 'not_found: group not found';
  end if;

  perform 1 from memberships where group_id = p_group_id and user_id = v_caller and status <> 'removed';
  if not found then
    raise exception 'not_found: group not found';
  end if;

  if v_caller <> v_group.owner_id then
    raise exception 'forbidden: only the group owner can transfer ownership';
  end if;

  if p_new_owner_id = v_caller then
    raise exception 'invalid_operation: you already own this group';
  end if;

  perform 1 from memberships where group_id = p_group_id and user_id = p_new_owner_id and status = 'active';
  if not found then
    raise exception 'invalid_operation: the new owner must be an active member of this group';
  end if;

  if v_group.is_public then
    perform 1 from memberships where group_id = p_group_id and user_id = p_new_owner_id and role = 'moderator';
    if not found then
      raise exception 'invalid_operation: pick an existing moderator to hand a public group to, assign one first if there isn''t one yet';
    end if;
  end if;

  update groups set owner_id = p_new_owner_id where id = p_group_id returning * into v_group;

  return v_group;
end;
$$;

revoke execute on function transfer_ownership(uuid, uuid) from public;
grant execute on function transfer_ownership(uuid, uuid) to authenticated;

-- remove_member: a public group's moderators can now ban a member too, not just the owner — the
-- same "quick way to kick a bad actor" safety valve mods already have for voiding a bad
-- auto-generated market. Everything else (refund/void cleanup, invite-code rotation) is unchanged;
-- a private group's remove_member is still owner-only exactly as before. Same 2-arg signature as
-- 20260708093000_leave_rejoin_patch.sql.
create or replace function remove_member(p_group_id uuid, p_target_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_group groups%rowtype;
begin
  select * into v_group from groups where id = p_group_id;
  if v_group.id is null then
    raise exception 'not_found: group not found';
  end if;

  if v_group.is_public then
    if not _is_group_mod_or_owner(p_group_id, v_caller) then
      raise exception 'forbidden: only a moderator can remove a member here';
    end if;
  else
    perform 1 from memberships where group_id = p_group_id and user_id = v_caller and status <> 'removed';
    if not found then
      raise exception 'not_found: group not found';
    end if;
    if v_caller <> v_group.owner_id then
      raise exception 'forbidden: only the group owner can remove members';
    end if;
  end if;

  if p_target_user_id = v_group.owner_id then
    raise exception 'invalid_operation: the owner cannot remove themself';
  end if;

  perform 1 from memberships
  where group_id = p_group_id and user_id = p_target_user_id and status <> 'removed'
  for update;
  if not found then
    raise exception 'not_found: user is not a member of this group';
  end if;

  perform _cleanup_departing_member(p_group_id, p_target_user_id, true);

  update memberships set status = 'removed'
  where group_id = p_group_id and user_id = p_target_user_id;

  update groups set invite_code = _generate_invite_code() where id = p_group_id;
end;
$$;

revoke execute on function remove_member(uuid, uuid) from public;
grant execute on function remove_member(uuid, uuid) to authenticated;
