-- forfeit_moderator: a moderator's self-service step-down, lighter than leave_group() (which
-- removes them from the group entirely). No authorization beyond "you currently hold the role" —
-- it only ever lowers the caller's own privilege, so there's nothing to gate beyond that.
create function forfeit_moderator(p_group_id uuid)
returns memberships
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_membership memberships%rowtype;
begin
  select * into v_membership
  from memberships
  where group_id = p_group_id and user_id = v_caller and status in ('active', 'dormant')
  for update;

  if v_membership.id is null then
    raise exception 'not_found: not a member of this group';
  end if;

  if v_membership.role <> 'moderator' then
    raise exception 'invalid_operation: you are not a moderator of this group';
  end if;

  update memberships set role = 'member' where id = v_membership.id returning * into v_membership;

  return v_membership;
end;
$$;

revoke execute on function forfeit_moderator(uuid) from public;
grant execute on function forfeit_moderator(uuid) to authenticated;

-- assign_group_moderator: demoting the group's last remaining moderator is now rejected outright,
-- rather than silently leaving a (possibly large) public group with nobody but the owner actively
-- running it day to day. Same 3-arg signature as 20260824160000, plain CREATE OR REPLACE.
create or replace function assign_group_moderator(
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
  v_moderator_count int;
begin
  if not is_platform_admin() then
    raise exception 'forbidden: admin only';
  end if;

  perform 1 from groups where id = p_group_id and is_public = true;
  if not found then
    raise exception 'not_found: group not found';
  end if;

  if not p_is_moderator then
    select count(*) into v_moderator_count
    from memberships
    where group_id = p_group_id and role = 'moderator' and status in ('active', 'dormant');

    if v_moderator_count <= 1 then
      perform 1 from memberships
      where group_id = p_group_id and user_id = p_target_user_id and role = 'moderator' and status in ('active', 'dormant');
      if found then
        raise exception 'invalid_operation: this group has no other moderator, assign a replacement first';
      end if;
    end if;
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
