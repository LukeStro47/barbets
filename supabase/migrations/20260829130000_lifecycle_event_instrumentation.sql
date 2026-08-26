-- Records a lifecycle_events row from inside the existing SECURITY DEFINER
-- functions that already do these mutations, rather than from the Next.js
-- Server Action layer -- consistent with "all mutation goes through SECURITY
-- DEFINER functions" and keeps lifecycle_events' zero-RLS-policy posture
-- intact (no client-facing insert policy needed). It also keeps the event
-- write atomic with the state change it describes: a bet_place row can never
-- exist without the bet having actually succeeded, and can never be silently
-- dropped by a Server Action that updated the DB but then failed before a
-- separate logging call ran.
--
-- Every function below keeps its exact existing signature, so each is a true
-- CREATE OR REPLACE, not a new overload -- no DROP FUNCTION needed.

-- join_group, redeclared from 20260813150000_join_group_returns_setof.sql
-- with one lifecycle_events insert added to each of the two genuinely-new-
-- membership branches (a reactivated dormant/left member is a rejoin, not a
-- first join, so those branches are left alone).
create or replace function join_group(p_invite_code text, p_nickname citext default null)
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
  perform _enforce_invite_code_rate_limit();

  select * into v_group from groups where invite_code = p_invite_code::citext;
  if v_group.id is null then
    -- Records and returns nothing rather than raising: a RAISE would abort the
    -- transaction and take the counter write with it.
    perform _record_invite_code_miss();
    return;
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
  if v_group.deletion_scheduled_at is not null then
    raise exception 'invalid_operation: this group is scheduled for deletion and isn''t taking new members';
  end if;

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

    perform _emit_notification_event('member_joined', v_group.id, null, null, v_user_id);
    insert into lifecycle_events (event_type, user_id, group_id) values ('group_join', v_user_id, v_group.id);

    return next v_membership;
    return;
  end if;

  v_seed := case when v_settings.seasons_enabled then v_active_season.seed_amount else v_settings.seed_amount end;

  insert into memberships (group_id, user_id, balance, status, nickname)
  values (v_group.id, v_user_id, v_seed, 'active', p_nickname)
  returning * into v_membership;

  insert into ledger (membership_id, amount, reason)
  values (v_membership.id, v_seed, 'seed');

  perform _emit_notification_event('member_joined', v_group.id, null, null, v_user_id);
  insert into lifecycle_events (event_type, user_id, group_id) values ('group_join', v_user_id, v_group.id);

  return next v_membership;
  return;
end;
$$;

revoke execute on function join_group(text, citext) from public;
grant execute on function join_group(text, citext) to authenticated;

-- create_group, redeclared from 20260811140000_token_allocation_and_season_name_caps.sql
-- with one lifecycle_events insert added before the return.
create or replace function create_group(
  p_name text,
  p_seed_amount int,
  p_seasons_enabled boolean default false,
  p_season_length season_length default null,
  p_nickname citext default null,
  p_timezone text default 'UTC',
  p_season_custom_ends_at timestamptz default null
) returns groups
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_group groups%rowtype;
  v_membership_id uuid;
  v_ends_at timestamptz;
  v_name text;
begin
  if v_user_id is null then
    raise exception 'not_found: unauthenticated';
  end if;

  v_name := nullif(trim(p_name), '');
  if v_name is null then
    raise exception 'invalid_operation: group name can''t be blank';
  end if;
  if length(v_name) > 60 then
    raise exception 'invalid_operation: group name must be 60 characters or fewer';
  end if;

  if p_seed_amount is null or p_seed_amount < 1 or p_seed_amount > 1000000 then
    raise exception 'invalid_operation: the token allocation must be between 1 and 1,000,000';
  end if;

  p_nickname := lower(trim(coalesce(p_nickname::text, '')))::citext;
  if p_nickname::text = '' then
    raise exception 'invalid_operation: choose a nickname to create a group with';
  end if;
  if p_nickname::text !~ '^[a-z0-9_]{1,20}$' then
    raise exception 'invalid_operation: nicknames can only use lowercase letters, numbers, and underscores, up to 20 characters';
  end if;
  if not exists (select 1 from pg_timezone_names where name = p_timezone) then
    raise exception 'invalid_operation: unrecognized time zone';
  end if;

  if p_seasons_enabled and p_season_length = 'custom' and (p_season_custom_ends_at is null or p_season_custom_ends_at <= now()) then
    raise exception 'invalid_operation: pick a custom season end date in the future';
  end if;

  insert into groups (name, owner_id, invite_code)
  values (v_name, v_user_id, _generate_invite_code())
  returning * into v_group;

  insert into group_settings (group_id, seed_amount, seasons_enabled, season_length, timezone, season_custom_ends_at)
  values (v_group.id, p_seed_amount, p_seasons_enabled, p_season_length, p_timezone, p_season_custom_ends_at);

  if p_seasons_enabled then
    v_ends_at := _compute_season_ends_at(p_season_length, p_season_custom_ends_at, now());
    insert into seasons (group_id, number, status, seed_amount, ends_at, season_length, betting_open)
    values (v_group.id, 1, 'active', p_seed_amount, v_ends_at, p_season_length, false);
  end if;

  insert into memberships (group_id, user_id, balance, status, nickname)
  values (v_group.id, v_user_id, p_seed_amount, 'active', p_nickname)
  returning id into v_membership_id;

  insert into ledger (membership_id, amount, reason)
  values (v_membership_id, p_seed_amount, 'seed');

  insert into lifecycle_events (event_type, user_id, group_id) values ('group_create', v_user_id, v_group.id);

  return v_group;
end;
$$;

-- create_public_group, redeclared from
-- 20260825200000_public_group_universal_loss_and_mod_settings.sql with one
-- lifecycle_events insert added before the return. Recorded as group_create
-- (the admin is the one creating the group) even though it's a staff
-- action, not a self-serve one -- the metadata flags it so a later query can
-- tell the two apart if that ever matters.
create or replace function create_public_group(
  p_name text,
  p_category text,
  p_seed_amount int,
  p_timezone text default 'UTC',
  p_nickname text default null,
  p_moderator_emails text[] default '{}'
) returns table (
  id uuid,
  name text,
  owner_id uuid,
  invite_code citext,
  created_at timestamptz,
  deletion_scheduled_at timestamptz,
  avatar_key text,
  is_public boolean,
  category text,
  unresolved_emails text[]
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_group groups%rowtype;
  v_membership_id uuid;
  v_name text;
  v_nickname citext;
  v_email text;
  v_target_id uuid;
  v_base_nickname citext;
  v_candidate citext;
  v_suffix int;
  v_unresolved text[] := '{}';
begin
  if not is_platform_admin(v_user_id) then
    raise exception 'forbidden: admin only';
  end if;

  v_name := nullif(trim(p_name), '');
  if v_name is null then
    raise exception 'invalid_operation: group name can''t be blank';
  end if;
  if length(v_name) > 60 then
    raise exception 'invalid_operation: group name must be 60 characters or fewer';
  end if;

  if p_category not in ('generic', 'campus') then
    raise exception 'invalid_operation: category must be generic or campus';
  end if;

  if p_seed_amount is null or p_seed_amount < 1 or p_seed_amount > 1000000 then
    raise exception 'invalid_operation: the token allocation must be between 1 and 1,000,000';
  end if;

  if not exists (select 1 from pg_timezone_names where pg_timezone_names.name = p_timezone) then
    raise exception 'invalid_operation: unrecognized time zone';
  end if;

  insert into groups (name, owner_id, invite_code, is_public, category)
  values (v_name, v_user_id, _generate_invite_code(), true, p_category)
  returning * into v_group;

  insert into group_settings (
    group_id, seed_amount, seasons_enabled, timezone, betting_enabled, accepting_members,
    allow_hedged_bets, require_endorsement, awards_enabled, distribute_payout, creator_payout_pct
  )
  values (v_group.id, p_seed_amount, false, p_timezone, true, true, false, false, false, true, 0);

  if p_nickname is not null and trim(p_nickname) <> '' then
    v_nickname := lower(trim(p_nickname))::citext;
    if v_nickname::text !~ '^[a-z0-9_]{1,20}$' then
      raise exception 'invalid_operation: nicknames can only use lowercase letters, numbers, and underscores, up to 20 characters';
    end if;
    if _nickname_contains_blocked_word(v_nickname::text) then
      raise exception 'invalid_operation: that nickname isn''t allowed, try a different one';
    end if;

    insert into memberships (group_id, user_id, balance, status, nickname, role)
    values (v_group.id, v_user_id, p_seed_amount, 'active', v_nickname, 'moderator')
    returning memberships.id into v_membership_id;

    insert into ledger (membership_id, amount, reason)
    values (v_membership_id, p_seed_amount, 'seed');
  end if;

  if p_moderator_emails is not null then
    foreach v_email in array p_moderator_emails loop
      v_email := nullif(trim(v_email), '');
      continue when v_email is null;

      select au.id into v_target_id from auth.users au where lower(au.email) = lower(v_email);
      if v_target_id is null then
        v_unresolved := v_unresolved || v_email;
        continue;
      end if;

      perform 1 from memberships where group_id = v_group.id and user_id = v_target_id;
      if found then
        continue;
      end if;

      v_base_nickname := lower(regexp_replace(split_part(v_email, '@', 1), '[^a-zA-Z0-9_]', '', 'g'));
      if v_base_nickname::text = '' or _nickname_contains_blocked_word(v_base_nickname::text) then
        v_base_nickname := 'mod';
      end if;
      v_base_nickname := left(v_base_nickname::text, 16)::citext;

      v_candidate := v_base_nickname;
      v_suffix := 1;
      while exists (
        select 1 from memberships where group_id = v_group.id and nickname = v_candidate and status not in ('removed', 'left')
      ) loop
        v_suffix := v_suffix + 1;
        v_candidate := (left(v_base_nickname::text, 16) || v_suffix::text)::citext;
      end loop;

      insert into memberships (group_id, user_id, balance, status, nickname, role)
      values (v_group.id, v_target_id, p_seed_amount, 'active', v_candidate, 'moderator')
      returning memberships.id into v_membership_id;

      insert into ledger (membership_id, amount, reason)
      values (v_membership_id, p_seed_amount, 'seed');

      perform _emit_notification_event('assigned_group_moderator', v_group.id, null, null, v_target_id);
    end loop;
  end if;

  insert into lifecycle_events (event_type, user_id, group_id, metadata)
  values ('group_create', v_user_id, v_group.id, jsonb_build_object('admin_created', true, 'category', p_category));

  return query select
    v_group.id, v_group.name, v_group.owner_id, v_group.invite_code, v_group.created_at,
    v_group.deletion_scheduled_at, v_group.avatar_key, v_group.is_public, v_group.category,
    v_unresolved;
end;
$$;

revoke execute on function create_public_group(text, text, int, text, text, text[]) from public;
grant execute on function create_public_group(text, text, int, text, text, text[]) to authenticated;

-- start_season, redeclared from 20260806160000_start_season_excludes_left.sql
-- with one lifecycle_events insert added before the return.
create or replace function start_season(p_group_id uuid)
returns seasons
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_group groups%rowtype;
  v_settings group_settings%rowtype;
  v_season seasons%rowtype;
  v_ends_at timestamptz;
  rec record;
begin
  select * into v_group from groups where id = p_group_id;
  if v_group.id is null then
    raise exception 'not_found: group not found';
  end if;

  perform 1 from memberships where group_id = p_group_id and user_id = v_caller and status not in ('removed', 'left');
  if not found then
    raise exception 'not_found: group not found';
  end if;

  if v_caller <> v_group.owner_id then
    raise exception 'forbidden: only the group owner can start the season';
  end if;

  select * into v_settings from group_settings where group_id = p_group_id;

  select * into v_season from seasons where group_id = p_group_id and status = 'intermission' for update;
  if v_season.id is null then
    raise exception 'invalid_operation: no season is in intermission, end the current season first';
  end if;

  v_ends_at := _compute_season_ends_at(v_settings.season_length, v_settings.season_custom_ends_at, now());
  if v_settings.season_length = 'custom' and v_ends_at <= now() then
    raise exception 'invalid_operation: that custom end date has already passed, pick a new one in settings before continuing';
  end if;

  update seasons
  set status = 'active', started_at = now(),
      seed_amount = v_settings.seed_amount,
      ends_at = v_ends_at,
      season_length = v_settings.season_length,
      betting_open = false
  where id = v_season.id
  returning * into v_season;

  for rec in
    select m.user_id
    from memberships m
    where m.group_id = p_group_id and m.status not in ('removed', 'left')
      and (
        (m.status = 'active' and not exists (
          select 1 from season_optouts so where so.season_id = v_season.id and so.user_id = m.user_id
        ))
        or
        (m.status = 'dormant' and exists (
          select 1 from season_optins si where si.season_id = v_season.id and si.user_id = m.user_id
        ))
      )
  loop
    update memberships
    set status = 'active', balance = v_season.seed_amount
    where group_id = p_group_id and user_id = rec.user_id;

    insert into ledger (membership_id, amount, reason)
    select id, v_season.seed_amount, 'seed'
    from memberships where group_id = p_group_id and user_id = rec.user_id;
  end loop;

  update memberships
  set status = 'dormant'
  where group_id = p_group_id
    and status not in ('removed', 'left')
    and user_id not in (
      select m.user_id
      from memberships m
      where m.group_id = p_group_id and m.status not in ('removed', 'left')
        and (
          (m.status = 'active' and not exists (
            select 1 from season_optouts so where so.season_id = v_season.id and so.user_id = m.user_id
          ))
          or
          (m.status = 'dormant' and exists (
            select 1 from season_optins si where si.season_id = v_season.id and si.user_id = m.user_id
          ))
        )
    );

  -- Continuing cancels a pending inactivity-triggered deletion outright --
  -- the existing "the owner canceled the deletion" copy stays accurate,
  -- since starting a season really is what canceled it.
  if v_group.deletion_scheduled_at is not null then
    update groups set deletion_scheduled_at = null where id = p_group_id;
    perform _emit_notification_event('group_deletion_canceled', p_group_id, null, null, v_caller);
  end if;

  insert into lifecycle_events (event_type, user_id, group_id, metadata)
  values ('season_start', v_caller, p_group_id, jsonb_build_object('season_id', v_season.id, 'season_number', v_season.number));

  return v_season;
end;
$$;

revoke execute on function start_season(uuid) from public;
grant execute on function start_season(uuid) to authenticated;

-- _end_season, redeclared from 20260813170000_end_season_callable_by_cron.sql
-- with one lifecycle_events insert added right after the season is marked
-- ended (regardless of whether it finalizes immediately or winds down).
-- p_actor_id is legitimately NULL here for a cron-triggered end (expire_stale
-- calling this with no human behind it) -- that's recorded as-is, not a bug,
-- same convention notification_events already uses for actor_id.
create or replace function _end_season(p_group_id uuid, p_actor_id uuid default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_settings group_settings%rowtype;
  v_season seasons%rowtype;
  v_in_flight int;
  rec record;
begin
  select * into v_settings from group_settings where group_id = p_group_id;

  select * into v_season from seasons where group_id = p_group_id and status = 'active' for update;
  if v_season.id is null then
    raise exception 'invalid_operation: no active season to end';
  end if;

  for rec in
    select id from markets
    where season_id = v_season.id and status in ('pending_sponsor', 'open', 'closed')
    for update
  loop
    perform _void_market(rec.id);
  end loop;

  select count(*) into v_in_flight
  from markets
  where season_id = v_season.id and status in ('proposed', 'disputed');

  update seasons set ended_at = now() where id = v_season.id;

  insert into lifecycle_events (event_type, user_id, group_id, metadata)
  values ('season_end', p_actor_id, p_group_id, jsonb_build_object('season_id', v_season.id, 'season_number', v_season.number));

  if v_in_flight = 0 then
    perform _finalize_season(v_season.id, p_actor_id);
  else
    update seasons
    set status = 'winding_down', wind_down_deadline = now() + (v_settings.resolution_window_hours * interval '1 hour')
    where id = v_season.id;
  end if;
end;
$$;

revoke execute on function _end_season(uuid, uuid) from public;
revoke execute on function _end_season(uuid, uuid) from authenticated;

-- create_market, redeclared from 20260826100000_fix_create_market_regression.sql
-- with one lifecycle_events insert added before the return.
create or replace function create_market(
  p_group_id uuid,
  p_title text,
  p_description text,
  p_market_type market_type,
  p_closes_at timestamptz,
  p_line numeric default null,
  p_subject_user_ids uuid[] default '{}',
  p_options text[] default null,
  p_unit text default null
) returns markets
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_settings group_settings%rowtype;
  v_season_id uuid;
  v_betting_open boolean;
  v_season_ends_at timestamptz;
  v_member_count int;
  v_subject_ids uuid[];
  v_invalid_subject_count int;
  v_market markets%rowtype;
  v_option_count int;
  v_option_id uuid;
  v_option_text text;
  v_resolved_user_id uuid;
  v_all_subject_ids uuid[];
  v_general_subject_ids uuid[];
  v_idx int;
  v_unit text;
  v_pending_bonus int;
  v_initial_status market_status;
  v_role_text text;
  v_title text;
  v_is_public boolean;
begin
  perform 1 from memberships where group_id = p_group_id and user_id = v_user_id and status not in ('removed', 'left');
  if not found then
    raise exception 'not_found: not a member of this group';
  end if;

  select is_public into v_is_public from groups where id = p_group_id;
  if v_is_public and not _is_group_mod_or_owner(p_group_id, v_user_id) then
    raise exception 'forbidden: only a moderator can create a market in this group';
  end if;

  perform 1 from groups where id = p_group_id and deletion_scheduled_at is not null;
  if found then
    raise exception 'invalid_operation: this group is scheduled for deletion and can''t start new markets';
  end if;

  select * into v_settings from group_settings where group_id = p_group_id;
  v_initial_status := case when v_settings.require_endorsement then 'pending_sponsor' else 'open' end;
  v_role_text := case when v_settings.require_endorsement then 'create, endorse, and bet on it' else 'create and bet on it' end;

  v_title := nullif(trim(p_title), '');
  if v_title is null then
    raise exception 'invalid_operation: market title can''t be blank';
  end if;
  if length(v_title) > 140 then
    raise exception 'invalid_operation: market title must be 140 characters or fewer (save the details for the resolution criteria)';
  end if;

  if p_closes_at <= now() then
    raise exception 'invalid_operation: closes_at must be in the future';
  end if;

  v_unit := nullif(trim(coalesce(p_unit, '')), '');
  if v_unit is not null then
    if p_market_type <> 'over_under' then
      raise exception 'invalid_operation: a unit only applies to over/under markets';
    end if;
    if length(v_unit) > 10 then
      raise exception 'invalid_operation: unit must be 10 characters or fewer';
    end if;
  end if;

  if v_settings.seasons_enabled then
    select id, betting_open, ends_at into v_season_id, v_betting_open, v_season_ends_at
    from seasons where group_id = p_group_id and status = 'active';
    if v_season_id is null then
      raise exception 'invalid_operation: the group is between seasons, wait for the new season to start';
    end if;
    if not v_betting_open then
      raise exception 'invalid_operation: the owner hasn''t opened betting for this season yet';
    end if;
    if v_season_ends_at is not null and p_closes_at > v_season_ends_at then
      raise exception 'invalid_operation: closes_at can''t be later than the season''s end';
    end if;
  else
    if not v_settings.betting_enabled then
      raise exception 'invalid_operation: the group owner hasn''t turned betting on yet';
    end if;
  end if;

  select count(*) into v_member_count from memberships where group_id = p_group_id and status not in ('removed', 'left');

  if p_market_type = 'multiple_choice' then
    v_option_count := coalesce(array_length(p_options, 1), 0);
    if v_option_count < 2 or v_option_count > 10 then
      raise exception 'invalid_operation: multiple choice markets need between 2 and 10 options';
    end if;

    if exists (select 1 from unnest(p_options) as o where trim(o) = '') then
      raise exception 'invalid_operation: option labels cannot be blank';
    end if;

    if exists (select 1 from unnest(p_options) as o where length(trim(o)) > 40) then
      raise exception 'invalid_operation: option labels must be 40 characters or fewer';
    end if;

    if (select count(distinct trim(o)) from unnest(p_options) as o) <> v_option_count then
      raise exception 'invalid_operation: option labels must be unique';
    end if;

    v_all_subject_ids := '{}';
    for v_idx in 1 .. v_option_count loop
      v_option_text := trim(p_options[v_idx]);
      if left(v_option_text, 1) = '@' then
        if v_is_public then
          raise exception 'invalid_operation: markets in this group can''t be about a specific person';
        end if;
        select m.user_id into v_resolved_user_id
        from memberships m
        where m.group_id = p_group_id and m.nickname = substring(v_option_text from 2) and m.status = 'active';
        if v_resolved_user_id is null then
          raise exception 'invalid_operation: no active member named % in this group', v_option_text;
        end if;
        v_all_subject_ids := v_all_subject_ids || v_resolved_user_id;
      end if;
    end loop;

    select array_agg(distinct x) into v_general_subject_ids from unnest(p_subject_user_ids) as x;
    if v_general_subject_ids is not null and v_is_public then
      raise exception 'invalid_operation: markets in this group can''t be about a specific person';
    end if;
    if v_general_subject_ids is not null and array_length(v_all_subject_ids, 1) > 0 then
      raise exception 'invalid_operation: a multiple choice market can be about someone via an @option or the About field, not both';
    end if;

    if array_length(v_all_subject_ids, 1) > 0 then
      if array_length(v_all_subject_ids, 1) <> (select count(distinct x) from unnest(v_all_subject_ids) as x) then
        raise exception 'invalid_operation: a member can only be a subject of one option';
      end if;

      if v_user_id = any(v_all_subject_ids) then
        raise exception 'invalid_operation: the creator cannot be a subject of their own market';
      end if;

      if array_length(v_all_subject_ids, 1) >= v_member_count - 1 then
        raise exception 'invalid_operation: this group has % members, so a market can have at most % subject(s). enough people need to be left to %', v_member_count, greatest(v_member_count - 2, 0), v_role_text;
      end if;
    end if;

    if v_general_subject_ids is not null then
      if v_user_id = any(v_general_subject_ids) then
        raise exception 'invalid_operation: the creator cannot be a subject of their own market';
      end if;

      if array_length(v_general_subject_ids, 1) >= v_member_count - 1 then
        raise exception 'invalid_operation: this group has % members, so a market can have at most % subject(s). enough people need to be left to %', v_member_count, greatest(v_member_count - 2, 0), v_role_text;
      end if;

      select count(*) into v_invalid_subject_count
      from unnest(v_general_subject_ids) as x
      where not exists (
        select 1 from memberships where group_id = p_group_id and user_id = x and status = 'active'
      );
      if v_invalid_subject_count > 0 then
        raise exception 'invalid_operation: all subjects must be active members of the group';
      end if;
    end if;

    insert into markets (group_id, season_id, title, description, market_type, line, creator_id, closes_at, unit, status)
    values (p_group_id, v_season_id, v_title, p_description, p_market_type, null, v_user_id, p_closes_at, null, v_initial_status)
    returning * into v_market;

    for v_idx in 1 .. v_option_count loop
      v_option_text := trim(p_options[v_idx]);

      insert into market_options (market_id, label, sort_order)
      values (v_market.id, v_option_text, v_idx)
      returning id into v_option_id;

      if left(v_option_text, 1) = '@' then
        select m.user_id into v_resolved_user_id
        from memberships m
        where m.group_id = p_group_id and m.nickname = substring(v_option_text from 2) and m.status = 'active';

        insert into market_subjects (market_id, user_id, option_id)
        values (v_market.id, v_resolved_user_id, v_option_id);
      end if;
    end loop;

    if v_general_subject_ids is not null then
      insert into market_subjects (market_id, user_id)
      select v_market.id, x from unnest(v_general_subject_ids) as x;
    end if;
  else
    select array_agg(distinct x) into v_subject_ids from unnest(p_subject_user_ids) as x;

    if v_subject_ids is not null and v_is_public then
      raise exception 'invalid_operation: markets in this group can''t be about a specific person';
    end if;

    if v_subject_ids is not null and v_user_id = any(v_subject_ids) then
      raise exception 'invalid_operation: the creator cannot be a subject of their own market';
    end if;

    if v_subject_ids is not null then
      if array_length(v_subject_ids, 1) >= v_member_count - 1 then
        raise exception 'invalid_operation: this group has % members, so a market can have at most % subject(s). enough people need to be left to %', v_member_count, greatest(v_member_count - 2, 0), v_role_text;
      end if;

      select count(*) into v_invalid_subject_count
      from unnest(v_subject_ids) as x
      where not exists (
        select 1 from memberships where group_id = p_group_id and user_id = x and status = 'active'
      );
      if v_invalid_subject_count > 0 then
        raise exception 'invalid_operation: all subjects must be active members of the group';
      end if;
    end if;

    insert into markets (group_id, season_id, title, description, market_type, line, creator_id, closes_at, unit, status)
    values (p_group_id, v_season_id, v_title, p_description, p_market_type, p_line, v_user_id, p_closes_at, v_unit, v_initial_status)
    returning * into v_market;

    if v_subject_ids is not null then
      insert into market_subjects (market_id, user_id)
      select v_market.id, x from unnest(v_subject_ids) as x;
    end if;
  end if;

  select pending_bonus_pool into v_pending_bonus from groups where id = p_group_id for update;
  if v_pending_bonus > 0 then
    update markets set bonus_pool = v_pending_bonus, carried_bonus_pool = v_pending_bonus where id = v_market.id
    returning * into v_market;
    update groups set pending_bonus_pool = 0 where id = p_group_id;
  end if;

  if v_initial_status = 'open' then
    perform _emit_notification_event('market_opened', p_group_id, v_market.id, null, v_user_id);
    if exists (select 1 from market_subjects where market_id = v_market.id) then
      perform _emit_notification_event('market_opened_about_you', p_group_id, v_market.id, null, v_user_id);
    end if;
  else
    perform _emit_notification_event('market_needs_endorsement', p_group_id, v_market.id, null, v_user_id);
  end if;

  insert into lifecycle_events (event_type, user_id, group_id, metadata)
  values ('market_create', v_user_id, p_group_id, jsonb_build_object('market_id', v_market.id, 'market_type', p_market_type));

  return v_market;
end;
$$;

revoke execute on function create_market(uuid, text, text, market_type, timestamptz, numeric, uuid[], text[], text) from public;
grant execute on function create_market(uuid, text, text, market_type, timestamptz, numeric, uuid[], text[], text) to authenticated;

-- place_bet, redeclared from 20260716140000_hedge_betting_setting.sql with
-- one lifecycle_events insert added before the return.
create or replace function place_bet(p_market_id uuid, p_side bet_side, p_amount int, p_option_id uuid default null)
returns bets
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_market markets%rowtype;
  v_membership memberships%rowtype;
  v_bet bets%rowtype;
begin
  select * into v_market from markets where id = p_market_id for update;
  if v_market.id is null then
    raise exception 'not_found: market not found';
  end if;

  if exists (select 1 from market_subjects where market_id = p_market_id and user_id = v_user_id) then
    raise exception 'not_found: market not found';
  end if;

  select * into v_membership
  from memberships
  where group_id = v_market.group_id and user_id = v_user_id
  for update;

  if v_membership.id is null or v_membership.status = 'removed' then
    raise exception 'not_found: not a member of this group';
  end if;

  if v_market.status <> 'open' or v_market.closes_at <= now() then
    raise exception 'invalid_operation: betting is not open on this market';
  end if;

  if v_market.market_type = 'multiple_choice' then
    if p_side is not null then
      raise exception 'invalid_operation: side does not match market type';
    end if;
    if p_option_id is null then
      raise exception 'invalid_operation: choose an option to bet on';
    end if;
    perform 1 from market_options where id = p_option_id and market_id = p_market_id;
    if not found then
      raise exception 'invalid_operation: option does not belong to this market';
    end if;
  else
    if p_option_id is not null then
      raise exception 'invalid_operation: this market does not use options';
    end if;
    if (v_market.market_type = 'yes_no' and p_side not in ('yes', 'no'))
       or (v_market.market_type = 'over_under' and p_side not in ('over', 'under')) then
      raise exception 'invalid_operation: side does not match market type';
    end if;
  end if;

  if v_membership.status = 'dormant' then
    raise exception 'invalid_operation: dormant members cannot bet, opt in to the current season first';
  end if;

  if not (select allow_hedged_bets from group_settings where group_id = v_market.group_id)
     and exists (
       select 1 from bets
       where market_id = p_market_id
         and user_id = v_user_id
         and (side is distinct from p_side or option_id is distinct from p_option_id)
     ) then
    raise exception 'invalid_operation: this group doesn''t allow betting on more than one side of a market, and you already have a bet on a different side here';
  end if;

  if v_membership.balance < 1 then
    raise exception 'insufficient_balance: you have no tokens to bet';
  end if;

  if p_amount < 1 or p_amount > v_membership.balance then
    raise exception 'invalid_operation: amount must be between 1 and your current balance of %', v_membership.balance;
  end if;

  insert into bets (market_id, user_id, side, amount, option_id)
  values (p_market_id, v_user_id, p_side, p_amount, p_option_id)
  returning * into v_bet;

  update memberships set balance = balance - p_amount where id = v_membership.id;

  insert into ledger (membership_id, amount, reason, market_id, bet_id)
  values (v_membership.id, -p_amount, 'bet', p_market_id, v_bet.id);

  insert into lifecycle_events (event_type, user_id, group_id, metadata)
  values ('bet_place', v_user_id, v_market.group_id, jsonb_build_object('market_id', p_market_id, 'amount', p_amount));

  return v_bet;
end;
$$;

revoke execute on function place_bet(uuid, bet_side, int, uuid) from public;
grant execute on function place_bet(uuid, bet_side, int, uuid) to authenticated;
