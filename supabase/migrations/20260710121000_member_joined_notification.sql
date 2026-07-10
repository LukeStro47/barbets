-- The owner gets a push the moment someone actually joins their group —
-- easy to miss otherwise since nothing else in the UI surfaces it in real
-- time. Fires only for a genuinely new membership (both the immediate-seed
-- and the dormant-pending-next-season paths in join_group()) — a dormant
-- member simply reactivating isn't a new person joining, so that path is
-- left as-is.

alter table notification_events drop constraint notification_events_market_events_have_market;
alter table notification_events add constraint notification_events_market_events_have_market check (
  (event_type in ('season_ended', 'betting_opened', 'member_joined')) or (market_id is not null)
);

-- get_event_recipients: member_joined is group-scoped like season_ended and
-- betting_opened, but its audience is just the one owner rather than the
-- whole roster — reuses actor_id-exclusion defensively even though the
-- actor (the joiner) is never the owner in practice.
create or replace function get_event_recipients(p_event_id uuid)
returns table (user_id uuid)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_event notification_events%rowtype;
begin
  select * into v_event from notification_events where id = p_event_id;
  if v_event.id is null then
    return;
  end if;

  if v_event.event_type = 'member_joined' then
    return query
    select g.owner_id as user_id
    from groups g
    join push_subscriptions ps on ps.user_id = g.owner_id
    join users u on u.id = g.owner_id and u.notifications_enabled = true
    where g.id = v_event.group_id
      and (v_event.actor_id is null or g.owner_id <> v_event.actor_id)
    group by g.owner_id;
  elsif v_event.event_type = 'impressive_bet' then
    return query
    select u.id as user_id
    from users u
    join push_subscriptions ps on ps.user_id = u.id
    where u.id = v_event.actor_id and u.notifications_enabled = true
    group by u.id;
  elsif v_event.event_type in ('season_ended', 'betting_opened') then
    return query
    select m.user_id
    from memberships m
    join push_subscriptions ps on ps.user_id = m.user_id
    join users u on u.id = m.user_id and u.notifications_enabled = true
    where m.group_id = v_event.group_id
      and m.status <> 'removed'
      and (v_event.actor_id is null or m.user_id <> v_event.actor_id)
    group by m.user_id;
  else
    return query
    select gnr.user_id
    from get_notification_recipients(v_event.market_id, v_event.event_type = 'market_resolved') gnr
    where v_event.actor_id is null or gnr.user_id <> v_event.actor_id;
  end if;
end;
$$;

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

    perform _emit_notification_event('member_joined', v_group.id, null, null, v_user_id);

    return v_membership;
  end if;

  v_seed := case when v_settings.seasons_enabled then v_active_season.seed_amount else v_settings.seed_amount end;

  insert into memberships (group_id, user_id, balance, status, nickname)
  values (v_group.id, v_user_id, v_seed, 'active', p_nickname)
  returning * into v_membership;

  insert into ledger (membership_id, amount, reason)
  values (v_membership.id, v_seed, 'seed');

  perform _emit_notification_event('member_joined', v_group.id, null, null, v_user_id);

  return v_membership;
end;
$$;

revoke execute on function join_group(text, citext) from public;
grant execute on function join_group(text, citext) to authenticated;
