-- Owner-only, discovered missing while building the settings page (spec:
-- "Owner can regenerate the code and remove members"). Same collision-retry
-- generator as create_group().
create or replace function regenerate_invite_code(p_group_id uuid)
returns groups
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_group groups%rowtype;
  v_invite_code citext;
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
    raise exception 'forbidden: only the group owner can regenerate the invite code';
  end if;

  loop
    v_invite_code := 'BB-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 4));
    exit when not exists (select 1 from groups where invite_code = v_invite_code);
  end loop;

  update groups set invite_code = v_invite_code where id = p_group_id returning * into v_group;

  return v_group;
end;
$$;

revoke execute on function regenerate_invite_code(uuid) from public;
grant execute on function regenerate_invite_code(uuid) to authenticated;
