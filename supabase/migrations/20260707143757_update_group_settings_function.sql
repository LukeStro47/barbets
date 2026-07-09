-- Owner-only settings edit, discovered missing while building the Phase 5
-- settings page (the spec requires "Owner can edit them from group
-- settings; changes to token allocation and cap take effect at the next
-- season"). group_settings is always the "currently configured, applies at
-- the next season boundary" value — see the season-snapshot comment in
-- 20260707123959_phase2_schema_refinements.sql — so a plain UPDATE here is
-- exactly correct for the seasons-already-on and seasons-off cases; the
-- only special case is turning seasons ON for the first time, which needs
-- an initial 'active' season row (mirroring create_group()), and turning
-- seasons OFF once enabled is deliberately not supported — there's no
-- non-surprising way to unwind an in-progress season/balance history, so
-- that's rejected with a clear error rather than silently doing something
-- ambiguous.
create or replace function update_group_settings(
  p_group_id uuid,
  p_seed_amount int,
  p_bet_cap_pct int,
  p_seasons_enabled boolean,
  p_season_length season_length default null
) returns group_settings
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
    raise exception 'forbidden: only the group owner can edit settings';
  end if;

  select * into v_settings from group_settings where group_id = p_group_id;

  if v_settings.seasons_enabled and not p_seasons_enabled then
    raise exception 'invalid_operation: seasons cannot be turned off once enabled';
  end if;

  update group_settings
  set seed_amount = p_seed_amount,
      bet_cap_pct = p_bet_cap_pct,
      seasons_enabled = p_seasons_enabled,
      season_length = p_season_length
  where group_id = p_group_id
  returning * into v_settings;

  if p_seasons_enabled and not exists (select 1 from seasons where group_id = p_group_id) then
    insert into seasons (group_id, number, status, seed_amount, bet_cap_pct)
    values (p_group_id, 1, 'active', p_seed_amount, p_bet_cap_pct);
  end if;

  return v_settings;
end;
$$;

revoke execute on function update_group_settings(uuid, int, int, boolean, season_length) from public;
grant execute on function update_group_settings(uuid, int, int, boolean, season_length) to authenticated;
