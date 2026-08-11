-- Length limits on the two free-text names people type most: a group's name
-- and a market's title. Neither had a server-side bound at all — the group
-- rename box carried a maxLength of 60 in the browser and nothing behind it,
-- and the market title had no cap on either side, so a pasted paragraph became
-- a market title that every card, feed row, and push notification then had to
-- render.
--
-- 60 for a group name matches what the rename input already allowed (so no
-- existing name that was typed through the UI can be too long) and what a
-- season name allows. 140 for a market title is deliberately generous — a
-- title is a question ("How many drinks will Jake have tonight?"), and the
-- specifics of what counts belong in the resolution criteria, which stays
-- uncapped.
--
-- Both checks measure the trimmed string and store the trimmed string, which
-- also gives create_group / create_market the blank-name rejection rename_group
-- already had (groups.name and markets.title are both not null, but a string of
-- spaces satisfies that and reads as an unnamed group in the UI).
--
-- The over/under custom unit tightens from 12 characters to 10 in the same pass.
-- A unit sits inline next to the line on cards and stat tiles, where 12 was
-- already past the point it reads as a unit rather than a sentence fragment.
-- Existing markets aren't rewritten and nothing re-validates them: unit is only
-- ever checked here, at creation, so any 11-12 character unit already stored
-- keeps rendering exactly as it does now.

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

  return v_group;
end;
$$;

create or replace function rename_group(p_group_id uuid, p_name text)
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
  if length(v_clean) > 60 then
    raise exception 'invalid_operation: group name must be 60 characters or fewer';
  end if;

  update groups set name = v_clean where id = p_group_id returning * into v_group;

  return v_group;
end;
$$;

-- create_market, redeclared verbatim from 20260806150000_fix_create_market_overload.sql
-- with only the title validation added. Same 9-parameter signature, so this is a
-- true replace, not a new overload.
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
begin
  perform 1 from memberships where group_id = p_group_id and user_id = v_user_id and status not in ('removed', 'left');
  if not found then
    raise exception 'not_found: not a member of this group';
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

    if (select count(distinct trim(o)) from unnest(p_options) as o) <> v_option_count then
      raise exception 'invalid_operation: option labels must be unique';
    end if;

    v_all_subject_ids := '{}';
    for v_idx in 1 .. v_option_count loop
      v_option_text := trim(p_options[v_idx]);
      if left(v_option_text, 1) = '@' then
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

  return v_market;
end;
$$;

revoke execute on function create_market(uuid, text, text, market_type, timestamptz, numeric, uuid[], text[], text) from public;
grant execute on function create_market(uuid, text, text, market_type, timestamptz, numeric, uuid[], text[], text) to authenticated;
