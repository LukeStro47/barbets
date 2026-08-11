-- Bounds on the two owner-set values that still had none: the token allocation
-- (`group_settings.seed_amount`) and a season's name.
--
-- seed_amount was accepted as any int on both create_group and
-- update_group_settings, so a slip on the keypad could seed a group with
-- 100,000,000 tokens, and every balance, bet amount, leaderboard figure, and
-- payout in that group renders at that scale forever after. 1,000,000 is the
-- ceiling: comfortably past any real "we want big round numbers" preference
-- and still short enough that a token figure fits the places that render one
-- (a card's stat tile, the betslip bar, a push notification body).
--
-- The floor is 1 rather than 0. The allocation input strips non-digits as you
-- type, so an emptied box submits Number('') = 0, which silently created a
-- group where nobody can ever place a bet; there is no configuration in which
-- a zero or negative allocation is what someone meant.
--
-- update_group_settings only applies the bound when the submitted value
-- differs from the stored one. The settings form re-submits every field on
-- every save, so an unconditional check would lock the owner of a
-- pre-existing over-cap group out of editing their time zone, or anything
-- else, until they noticed the allocation was the thing being rejected. This
-- way an already-stored figure keeps working and simply can't be moved
-- anywhere except into range.
--
-- 60 for a season name matches the group-name cap from
-- 20260810170000_name_and_unit_length_limits.sql, and matches what the season
-- rename input already allowed in the browser, so no name typed through the
-- UI can be too long. Unlike a group name, blank stays legal: seasons.name is
-- nullable and clearing it is how you get back to the "Season N" display
-- fallback.

-- create_group, redeclared from 20260810170000_name_and_unit_length_limits.sql
-- with only the seed-amount check added. Same 7-parameter signature, so this
-- is a true replace, not a new overload.
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

  return v_group;
end;
$$;

-- update_group_settings, redeclared from
-- 20260810130000_remove_endorser_payout_cut.sql with only the seed-amount
-- check added (after the settings row is loaded, since the check compares
-- against the stored value). Same 13-parameter signature, so no DROP is
-- needed and none of the existing call sites move.
create or replace function update_group_settings(
  p_group_id uuid,
  p_seed_amount int,
  p_seasons_enabled boolean,
  p_season_length season_length default null,
  p_timezone text default 'UTC',
  p_betting_enabled boolean default false,
  p_accepting_members boolean default true,
  p_distribute_payout boolean default false,
  p_creator_payout_pct int default 25,
  p_allow_hedged_bets boolean default true,
  p_season_custom_ends_at timestamptz default null,
  p_resolution_window_hours numeric default 8,
  p_require_endorsement boolean default true
) returns group_settings
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_group groups%rowtype;
  v_settings group_settings%rowtype;
  v_was_betting_enabled boolean;
  v_ends_at timestamptz;
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

  if p_creator_payout_pct < 0 or p_creator_payout_pct > 100 then
    raise exception 'invalid_operation: the creator percentage must be between 0 and 100';
  end if;

  if p_resolution_window_hours < 0.5 or p_resolution_window_hours > 10 then
    raise exception 'invalid_operation: the challenge/resolution window must be between 0.5 and 10 hours';
  end if;
  if p_resolution_window_hours * 2 <> floor(p_resolution_window_hours * 2) then
    raise exception 'invalid_operation: the challenge/resolution window must be in half-hour steps';
  end if;

  if p_seasons_enabled and p_season_length = 'custom' and (p_season_custom_ends_at is null or p_season_custom_ends_at <= now()) then
    raise exception 'invalid_operation: pick a custom season end date in the future';
  end if;

  select * into v_settings from group_settings where group_id = p_group_id;
  v_was_betting_enabled := v_settings.betting_enabled;

  -- Bound only a value that's actually changing, so a group stored above the
  -- cap before this migration can still save the rest of its settings (see
  -- the note at the top of this file).
  if p_seed_amount is distinct from v_settings.seed_amount
     and (p_seed_amount is null or p_seed_amount < 1 or p_seed_amount > 1000000) then
    raise exception 'invalid_operation: the token allocation must be between 1 and 1,000,000';
  end if;

  if v_settings.seasons_enabled and not p_seasons_enabled then
    raise exception 'invalid_operation: seasons cannot be turned off once enabled';
  end if;

  if v_was_betting_enabled and not p_betting_enabled then
    raise exception 'invalid_operation: betting cannot be turned off once enabled, end the season instead to pause things';
  end if;

  update group_settings
  set seed_amount = p_seed_amount,
      seasons_enabled = p_seasons_enabled,
      season_length = p_season_length,
      timezone = p_timezone,
      betting_enabled = p_betting_enabled,
      accepting_members = p_accepting_members,
      distribute_payout = p_distribute_payout,
      creator_payout_pct = p_creator_payout_pct,
      allow_hedged_bets = p_allow_hedged_bets,
      season_custom_ends_at = p_season_custom_ends_at,
      resolution_window_hours = p_resolution_window_hours,
      require_endorsement = p_require_endorsement
  where group_id = p_group_id
  returning * into v_settings;

  if p_seasons_enabled and not exists (select 1 from seasons where group_id = p_group_id) then
    v_ends_at := _compute_season_ends_at(p_season_length, p_season_custom_ends_at, now());
    insert into seasons (group_id, number, status, seed_amount, ends_at, season_length, betting_open)
    values (p_group_id, 1, 'active', p_seed_amount, v_ends_at, p_season_length, false);
  end if;

  if p_betting_enabled and not v_was_betting_enabled then
    perform _emit_notification_event('betting_opened', p_group_id, null, null, v_caller);
  end if;

  return v_settings;
end;
$$;

-- rename_season, redeclared from
-- 20260719145000_season_start_optout_functions.sql with only the length check
-- added. Same 2-parameter signature.
create or replace function rename_season(p_season_id uuid, p_name text)
returns seasons
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_season seasons%rowtype;
  v_owner_id uuid;
  v_clean text;
begin
  select * into v_season from seasons where id = p_season_id for update;
  if v_season.id is null then
    raise exception 'not_found: season not found';
  end if;

  perform 1 from memberships where group_id = v_season.group_id and user_id = v_caller and status <> 'removed';
  if not found then
    raise exception 'not_found: season not found';
  end if;

  select owner_id into v_owner_id from groups where id = v_season.group_id;
  if v_caller <> v_owner_id then
    raise exception 'forbidden: only the group owner can rename a season';
  end if;

  v_clean := nullif(trim(p_name), '');
  -- Blank stays legal here, unlike rename_group: null is the "Season N"
  -- fallback, not a missing name.
  if v_clean is not null and length(v_clean) > 60 then
    raise exception 'invalid_operation: season name must be 60 characters or fewer';
  end if;

  update seasons set name = v_clean where id = p_season_id returning * into v_season;

  return v_season;
end;
$$;
