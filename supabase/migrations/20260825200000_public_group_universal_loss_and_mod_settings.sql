-- Two changes to update_group_settings(), same 15-arg signature as 20260825100000, plain CREATE OR
-- REPLACE:
--
-- 1. A public group's universal-loss handling joins the fixed-rule set: distribute_payout forced
--    true, creator_payout_pct forced 0. _finalize_market_core() already does exactly "pool 100%
--    into the group's other open markets (or pending_bonus_pool if none)" once creator_payout_pct
--    is 0 — no separate code path needed, this is purely a settings-coercion change.
-- 2. A public group's moderators (not just its owner) can now call this — the whole reason mods
--    exist is to share day-to-day running of the group, and "change the token allocation or time
--    zone" is exactly that. Also incidentally unblocks the one real gap this created: an admin who
--    created the group without joining it (create_public_group()'s now-optional p_nickname) is
--    still groups.owner_id and therefore still passes _is_group_mod_or_owner() even with no
--    membership row, so they aren't locked out of their own group's settings either. A private
--    group's owner-only rule is completely unchanged.
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
  p_require_endorsement boolean default true,
  p_join_message text default null,
  p_awards_enabled boolean default true
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
  v_join_message text;
begin
  select * into v_group from groups where id = p_group_id;
  if v_group.id is null then
    raise exception 'not_found: group not found';
  end if;

  if v_group.is_public then
    -- A public-group caller with no membership row at all (the "admin didn't join" case) is only
    -- ever legitimate when they're the actual owner — that's exactly what _is_group_mod_or_owner
    -- checks next. Anyone else with no membership is a genuine stranger and gets the same
    -- not_found a private group's caller would.
    if v_caller <> v_group.owner_id then
      perform 1 from memberships where group_id = p_group_id and user_id = v_caller and status <> 'removed';
      if not found then
        raise exception 'not_found: group not found';
      end if;
    end if;
    if not _is_group_mod_or_owner(p_group_id, v_caller) then
      raise exception 'forbidden: only the owner or a moderator can edit settings';
    end if;
  else
    perform 1 from memberships where group_id = p_group_id and user_id = v_caller and status <> 'removed';
    if not found then
      raise exception 'not_found: group not found';
    end if;
    if v_caller <> v_group.owner_id then
      raise exception 'forbidden: only the group owner can edit settings';
    end if;
  end if;

  -- Public groups: seasons/hedging/endorsement are fixed off, accepting members/betting/universal-
  -- loss-pooling are fixed on (with the whole pool going to the creator's cut of 0%, i.e. entirely
  -- to other open markets), awards is fixed off. None of this is a preference for a public group —
  -- forcing it here, before validation, means a stray form post can never momentarily violate the
  -- rule even if it gets past the client.
  if v_group.is_public then
    p_seasons_enabled := false;
    p_season_length := null;
    p_allow_hedged_bets := false;
    p_require_endorsement := false;
    p_accepting_members := true;
    p_betting_enabled := true;
    p_awards_enabled := false;
    p_distribute_payout := true;
    p_creator_payout_pct := 0;
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

  v_join_message := nullif(trim(coalesce(p_join_message, '')), '');
  if v_join_message is not null and length(v_join_message) > 240 then
    raise exception 'invalid_operation: the join message must be 240 characters or fewer';
  end if;

  select * into v_settings from group_settings where group_id = p_group_id;
  v_was_betting_enabled := v_settings.betting_enabled;

  -- Bound only a value that's actually changing, so a group stored above the
  -- cap before this migration can still save the rest of its settings (see
  -- 20260811140000_token_allocation_and_season_name_caps.sql).
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
      require_endorsement = p_require_endorsement,
      join_message = v_join_message,
      awards_enabled = p_awards_enabled
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

revoke execute on function update_group_settings(uuid, int, boolean, season_length, text, boolean, boolean, boolean, int, boolean, timestamptz, numeric, boolean, text, boolean) from public;
grant execute on function update_group_settings(uuid, int, boolean, season_length, text, boolean, boolean, boolean, int, boolean, timestamptz, numeric, boolean, text, boolean) to authenticated;

-- create_public_group: group_settings insert now sets distribute_payout/creator_payout_pct
-- explicitly too, same reasoning as every other hard-rule flag already set here. Same signature as
-- 20260825160000's fix, plain CREATE OR REPLACE.
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

  return query select
    v_group.id, v_group.name, v_group.owner_id, v_group.invite_code, v_group.created_at,
    v_group.deletion_scheduled_at, v_group.avatar_key, v_group.is_public, v_group.category,
    v_unresolved;
end;
$$;

revoke execute on function create_public_group(text, text, int, text, text, text[]) from public;
grant execute on function create_public_group(text, text, int, text, text, text[]) to authenticated;

-- Backfill for existing public groups, same reasoning as 20260825100000's backfill.
update group_settings
set distribute_payout = true,
    creator_payout_pct = 0
where group_id in (select id from groups where is_public = true);
