-- Three owner powers (close invites, transfer ownership, delete the group
-- outright) plus self-service account deletion.

-- "Not accepting new members": a lighter-weight alternative to constantly
-- rotating the invite code. Only gates the genuinely-new-membership branch
-- of join_group() — a dormant member coming back, or an already-active
-- no-op, is never blocked by this (they're not "new").
alter table group_settings add column accepting_members boolean not null default true;

create or replace function join_group(p_invite_code text, p_nickname citext default null)
returns memberships
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_group groups%rowtype;
  v_settings group_settings%rowtype;
  v_active_season seasons%rowtype;
  v_intermission_season seasons%rowtype;
  v_membership memberships%rowtype;
  v_seed int;
begin
  select * into v_group from groups where invite_code = p_invite_code::citext;
  if v_group.id is null then
    raise exception 'not_found: invalid invite code';
  end if;

  select * into v_membership from memberships where group_id = v_group.id and user_id = v_user_id;
  if v_membership.id is not null then
    if v_membership.status = 'removed' then
      raise exception 'forbidden: you can''t rejoin this group';
    end if;
    if v_membership.status = 'dormant' then
      update memberships set status = 'active' where id = v_membership.id returning * into v_membership;
    end if;
    return v_membership;
  end if;

  -- Only a genuinely new membership reaches here.
  select * into v_settings from group_settings where group_id = v_group.id;
  if not v_settings.accepting_members then
    raise exception 'invalid_operation: this group isn''t accepting new members right now';
  end if;

  if p_nickname is null or trim(p_nickname::text) = '' then
    raise exception 'invalid_operation: choose a nickname to join with';
  end if;
  if p_nickname::text !~ '^[A-Za-z0-9_]{1,20}$' then
    raise exception 'invalid_operation: nicknames can only use letters, numbers, and underscores, up to 20 characters';
  end if;
  perform 1 from memberships where group_id = v_group.id and nickname = p_nickname and status <> 'removed';
  if found then
    raise exception 'invalid_operation: that nickname is already taken in this group';
  end if;

  if v_settings.seasons_enabled then
    select * into v_active_season from seasons where group_id = v_group.id and status = 'active';
  end if;

  if v_settings.seasons_enabled and v_active_season.id is null then
    select * into v_intermission_season from seasons where group_id = v_group.id and status = 'intermission';

    insert into memberships (group_id, user_id, balance, status, nickname)
    values (v_group.id, v_user_id, 0, 'dormant', p_nickname)
    returning * into v_membership;

    if v_intermission_season.id is not null then
      insert into season_optins (season_id, user_id)
      values (v_intermission_season.id, v_user_id)
      on conflict do nothing;
    end if;

    return v_membership;
  end if;

  v_seed := case when v_settings.seasons_enabled then v_active_season.seed_amount else v_settings.seed_amount end;

  insert into memberships (group_id, user_id, balance, status, nickname)
  values (v_group.id, v_user_id, v_seed, 'active', p_nickname)
  returning * into v_membership;

  insert into ledger (membership_id, amount, reason)
  values (v_membership.id, v_seed, 'seed');

  return v_membership;
end;
$$;

revoke execute on function join_group(text, citext) from public;
grant execute on function join_group(text, citext) to authenticated;

create or replace function update_group_settings(
  p_group_id uuid,
  p_seed_amount int,
  p_bet_cap_pct int,
  p_seasons_enabled boolean,
  p_season_length season_length default null,
  p_timezone text default 'UTC',
  p_betting_enabled boolean default false,
  p_accepting_members boolean default true
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
      timezone = p_timezone,
      betting_enabled = p_betting_enabled,
      accepting_members = p_accepting_members
  where group_id = p_group_id
  returning * into v_settings;

  if p_seasons_enabled and not exists (select 1 from seasons where group_id = p_group_id) then
    insert into seasons (group_id, number, status, seed_amount, bet_cap_pct)
    values (p_group_id, 1, 'active', p_seed_amount, p_bet_cap_pct);
  end if;

  return v_settings;
end;
$$;

revoke execute on function update_group_settings(uuid, int, int, boolean, season_length, text, boolean, boolean) from public;
grant execute on function update_group_settings(uuid, int, int, boolean, season_length, text, boolean, boolean) to authenticated;

-- transfer_ownership: hands the group to a different active member. The old
-- owner becomes a regular member afterward — nothing else about their
-- membership changes, and they can now be removed or leave like anyone else.
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

  update groups set owner_id = p_new_owner_id where id = p_group_id returning * into v_group;

  return v_group;
end;
$$;

revoke execute on function transfer_ownership(uuid, uuid) from public;
grant execute on function transfer_ownership(uuid, uuid) to authenticated;

-- delete_group: irreversible. Every group-scoped table cascades from
-- groups.id (verified against the full schema when this same cascade chain
-- was used for the full-database wipe earlier), so a plain DELETE here is
-- enough — no manual cleanup of markets/bets/seasons/etc needed.
create or replace function delete_group(p_group_id uuid)
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

  perform 1 from memberships where group_id = p_group_id and user_id = v_caller and status <> 'removed';
  if not found then
    raise exception 'not_found: group not found';
  end if;

  if v_caller <> v_group.owner_id then
    raise exception 'forbidden: only the group owner can delete the group';
  end if;

  delete from groups where id = p_group_id;
end;
$$;

revoke execute on function delete_group(uuid) from public;
grant execute on function delete_group(uuid) to authenticated;

-- delete_account: the public-schema half of account deletion. Blocks while
-- the caller still owns any group (they must transfer ownership or delete
-- it first — too consequential to resolve automatically on their behalf).
-- For every other group they're in, mirrors remove_member()'s cleanup on
-- themselves: void+refund any market they're a subject of, refund their own
-- open bets (they won't be back to collect on them), permanently mark the
-- membership removed, and rotate the invite code. The actual auth.users row
-- is deleted separately by the server action, via the admin client — this
-- function only ever touches the public schema.
create or replace function delete_account()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  rec record;
begin
  if v_user_id is null then
    raise exception 'not_found: unauthenticated';
  end if;

  perform 1 from groups where owner_id = v_user_id;
  if found then
    raise exception 'invalid_operation: transfer ownership or delete the groups you own before deleting your account';
  end if;

  for rec in
    select group_id from memberships where user_id = v_user_id and status <> 'removed'
  loop
    perform _cleanup_departing_member(rec.group_id, v_user_id, true);

    update memberships set status = 'removed'
    where group_id = rec.group_id and user_id = v_user_id;

    update groups set invite_code = _generate_invite_code() where id = rec.group_id;
  end loop;
end;
$$;

revoke execute on function delete_account() from public;
grant execute on function delete_account() to authenticated;
