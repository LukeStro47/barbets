-- join_public_group no longer emits member_joined. A private group's join is a rare, personal
-- event worth pinging the owner about; a public group's is a directory browse-and-join that can
-- happen constantly, and there's no single "the mods" recipient list that scales with it the way
-- one owner does for a private group. Same 2-arg signature as 20260825130000, plain CREATE OR
-- REPLACE — the only change is the two now-removed _emit_notification_event('member_joined', ...)
-- calls.
create or replace function join_public_group(p_group_id uuid, p_nickname citext default null)
returns setof memberships
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
  select * into v_group from groups where id = p_group_id and is_public = true;
  if v_group.id is null then
    raise exception 'not_found: group not found';
  end if;

  select * into v_membership from memberships where group_id = v_group.id and user_id = v_user_id;
  if v_membership.id is not null then
    if v_membership.status = 'removed' then
      raise exception 'forbidden: you can''t rejoin this group';
    end if;

    if v_membership.status = 'dormant' then
      update memberships set status = 'active' where id = v_membership.id returning * into v_membership;
      return next v_membership;
      return;
    end if;

    if v_membership.status = 'left' then
      if p_nickname is null or trim(p_nickname::text) = '' then
        raise exception 'invalid_operation: choose a nickname to join with';
      end if;
      if p_nickname::text !~ '^[A-Za-z0-9_]{1,20}$' then
        raise exception 'invalid_operation: nicknames can only use letters, numbers, and underscores, up to 20 characters';
      end if;
      if _nickname_contains_blocked_word(p_nickname::text) then
        raise exception 'invalid_operation: that nickname isn''t allowed, try a different one';
      end if;
      perform 1 from memberships where group_id = v_group.id and nickname = p_nickname and status not in ('removed', 'left');
      if found then
        raise exception 'invalid_operation: that nickname is already taken in this group';
      end if;

      update memberships set status = 'active', nickname = p_nickname where id = v_membership.id returning * into v_membership;
      return next v_membership;
      return;
    end if;

    return next v_membership;
    return;
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
  if _nickname_contains_blocked_word(p_nickname::text) then
    raise exception 'invalid_operation: that nickname isn''t allowed, try a different one';
  end if;
  perform 1 from memberships where group_id = v_group.id and nickname = p_nickname and status not in ('removed', 'left');
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

    return next v_membership;
    return;
  end if;

  v_seed := case when v_settings.seasons_enabled then v_active_season.seed_amount else v_settings.seed_amount end;

  insert into memberships (group_id, user_id, balance, status, nickname)
  values (v_group.id, v_user_id, v_seed, 'active', p_nickname)
  returning * into v_membership;

  insert into ledger (membership_id, amount, reason)
  values (v_membership.id, v_seed, 'seed');

  return next v_membership;
  return;
end;
$$;

revoke execute on function join_public_group(uuid, citext) from public;
grant execute on function join_public_group(uuid, citext) to authenticated;
