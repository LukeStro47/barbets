-- open_betting: a dedicated owner-only action for turning on a non-seasonal group's one-time
-- betting_enabled switch, mirroring open_season_betting's shape for the per-season equivalent.
-- Previously the only way to flip this on was the full "How this group plays" settings form
-- (update_group_settings), which buried a first-run action an owner needs immediately behind a
-- settings screen most people never open. This doesn't replace that toggle -- update_group_settings
-- still accepts p_betting_enabled and still enforces the same one-way rule -- it's a narrower,
-- single-purpose entry point the group hub page can call directly, same relationship
-- open_season_betting has to update_group_settings' season-scoped fields.
create or replace function open_betting(p_group_id uuid)
returns group_settings
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_group groups%rowtype;
  v_settings group_settings%rowtype;
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
    raise exception 'forbidden: only the group owner can open betting';
  end if;

  select * into v_settings from group_settings where group_id = p_group_id;

  if v_settings.seasons_enabled then
    raise exception 'invalid_operation: this group uses seasons, open betting for the season instead';
  end if;

  if v_settings.betting_enabled then
    raise exception 'invalid_operation: betting is already open';
  end if;

  update group_settings set betting_enabled = true where group_id = p_group_id returning * into v_settings;

  perform _emit_notification_event('betting_opened', p_group_id, null, null, v_caller);

  return v_settings;
end;
$$;

revoke execute on function open_betting(uuid) from public;
grant execute on function open_betting(uuid) to authenticated;
