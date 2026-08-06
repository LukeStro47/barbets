-- rename_group: owner-only. Mirrors rename_season's shape (select-for-update,
-- membership-existence check masked as not_found same as non-existence,
-- owner check, trim+update), but unlike rename_season's nullable
-- name-with-"Season N"-fallback, groups.name is not null, so a blank or
-- whitespace-only name is rejected outright instead of clearing to a fallback.
create function rename_group(p_group_id uuid, p_name text)
returns groups
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_group groups%rowtype;
  v_clean text;
begin
  select * into v_group from groups where id = p_group_id for update;
  if v_group.id is null then
    raise exception 'not_found: group not found';
  end if;

  perform 1 from memberships where group_id = v_group.id and user_id = v_caller and status <> 'removed';
  if not found then
    raise exception 'not_found: group not found';
  end if;

  if v_caller <> v_group.owner_id then
    raise exception 'forbidden: only the group owner can rename the group';
  end if;

  v_clean := nullif(trim(p_name), '');
  if v_clean is null then
    raise exception 'invalid_operation: group name can''t be blank';
  end if;

  update groups set name = v_clean where id = p_group_id returning * into v_group;

  return v_group;
end;
$$;

revoke execute on function rename_group(uuid, text) from public;
grant execute on function rename_group(uuid, text) to authenticated;
