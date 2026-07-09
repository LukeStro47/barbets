-- Group-level reference time zone, purely informational: it's shown as a
-- caption next to every "betting closes" field/display so members in
-- different time zones know what the closing time actually meant to
-- whoever set it. The datetime-local input itself still reads/writes in
-- the visiting browser's own local time — there's no way to make that input
-- interpret an arbitrary IANA zone without real timezone-math, which is a
-- bigger feature than "tell people what zone the owner had in mind."
alter table group_settings add column timezone text not null default 'UTC';

create or replace function create_group(
  p_name text,
  p_seed_amount int,
  p_bet_cap_pct int,
  p_seasons_enabled boolean default false,
  p_season_length season_length default null,
  p_nickname citext default null,
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
begin
  if v_user_id is null then
    raise exception 'not_found: unauthenticated';
  end if;

  if p_nickname is null or trim(p_nickname::text) = '' then
    raise exception 'invalid_operation: choose a nickname to create a group with';
  end if;
  if p_nickname::text !~ '^[A-Za-z0-9_]{1,20}$' then
    raise exception 'invalid_operation: nicknames can only use letters, numbers, and underscores, up to 20 characters';
  end if;
  if not exists (select 1 from pg_timezone_names where name = p_timezone) then
    raise exception 'invalid_operation: unrecognized time zone';
  end if;

  insert into groups (name, owner_id, invite_code)
  values (p_name, v_user_id, _generate_invite_code())
  returning * into v_group;

  insert into group_settings (group_id, seed_amount, bet_cap_pct, seasons_enabled, season_length, timezone)
  values (v_group.id, p_seed_amount, p_bet_cap_pct, p_seasons_enabled, p_season_length, p_timezone);

  if p_seasons_enabled then
    insert into seasons (group_id, number, status, seed_amount, bet_cap_pct)
    values (v_group.id, 1, 'active', p_seed_amount, p_bet_cap_pct);
  end if;

  insert into memberships (group_id, user_id, balance, status, nickname)
  values (v_group.id, v_user_id, p_seed_amount, 'active', p_nickname)
  returning id into v_membership_id;

  insert into ledger (membership_id, amount, reason)
  values (v_membership_id, p_seed_amount, 'seed');

  return v_group;
end;
$$;

revoke execute on function create_group(text, int, int, boolean, season_length, citext, text) from public;
grant execute on function create_group(text, int, int, boolean, season_length, citext, text) to authenticated;

create or replace function update_group_settings(
  p_group_id uuid,
  p_seed_amount int,
  p_bet_cap_pct int,
  p_seasons_enabled boolean,
  p_season_length season_length default null,
  p_timezone text default 'UTC'
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

  if not exists (select 1 from pg_timezone_names where name = p_timezone) then
    raise exception 'invalid_operation: unrecognized time zone';
  end if;

  select * into v_settings from group_settings where group_id = p_group_id;

  if v_settings.seasons_enabled and not p_seasons_enabled then
    raise exception 'invalid_operation: seasons cannot be turned off once enabled';
  end if;

  update group_settings
  set seed_amount = p_seed_amount,
      bet_cap_pct = p_bet_cap_pct,
      seasons_enabled = p_seasons_enabled,
      season_length = p_season_length,
      timezone = p_timezone
  where group_id = p_group_id
  returning * into v_settings;

  if p_seasons_enabled and not exists (select 1 from seasons where group_id = p_group_id) then
    insert into seasons (group_id, number, status, seed_amount, bet_cap_pct)
    values (p_group_id, 1, 'active', p_seed_amount, p_bet_cap_pct);
  end if;

  return v_settings;
end;
$$;

revoke execute on function update_group_settings(uuid, int, int, boolean, season_length, text) from public;
grant execute on function update_group_settings(uuid, int, int, boolean, season_length, text) to authenticated;
