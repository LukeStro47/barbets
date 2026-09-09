-- 7-day login reward (GitHub #92), part 3: update_group_settings() learns p_login_reward_amount.
--
-- A new trailing parameter changes the function's identity, so the 17-arg overload from
-- 20260903140000 is dropped by its exact signature first -- CREATE OR REPLACE alone would leave
-- it standing as a second overload and PostgREST would refuse every call (the trap this project
-- has hit six times, see ARCHITECTURE.md's "notable design decisions"). The body below is
-- 20260903140000's in full -- every gate, coercion, bound, the settings_update audit row, the
-- first-season creation + season_id backfill, and the betting_opened emit -- plus exactly these
-- additions, each marked "login reward" inline:
--   * p_login_reward_amount int default null (null = 5% of seed_amount, computed at claim time;
--     0 = off; see 20260909210000 for why null rather than a materialized default)
--   * coerced back to null for a public group, same as every other fixed-rule setting there
--   * recorded in the settings_update audit's changed_fields (as a "basic" change, next to
--     seed_amount)
--   * bounded to 0..1,000,000 only when the submitted value differs from the stored one, same
--     grandfathering rule seed_amount uses (a form that re-submits every field on every save
--     must never lock an owner out over a field they didn't touch)
--   * written by the UPDATE
drop function if exists update_group_settings(uuid, int, boolean, season_length, text, boolean, boolean, boolean, int, boolean, timestamptz, numeric, boolean, text, boolean, text, text);

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
  p_awards_enabled boolean default true,
  p_prize_text text default null,
  p_punishment_text text default null,
  p_login_reward_amount int default null
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
  v_prize_text text;
  v_punishment_text text;
  v_season_id uuid;
  v_changed_fields text[];
  v_basic_changed boolean;
  v_advanced_changed boolean;
begin
  select * into v_group from groups where id = p_group_id;
  if v_group.id is null then
    raise exception 'not_found: group not found';
  end if;

  if v_group.is_public then
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
    p_prize_text := null;
    p_punishment_text := null;
    p_login_reward_amount := null; -- login reward: public groups keep the 5% default, not a per-group figure
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

  v_prize_text := nullif(trim(coalesce(p_prize_text, '')), '');
  if v_prize_text is not null and length(v_prize_text) > 120 then
    raise exception 'invalid_operation: the prize must be 120 characters or fewer';
  end if;

  v_punishment_text := nullif(trim(coalesce(p_punishment_text, '')), '');
  if v_punishment_text is not null and length(v_punishment_text) > 120 then
    raise exception 'invalid_operation: the punishment must be 120 characters or fewer';
  end if;

  select * into v_settings from group_settings where group_id = p_group_id;
  v_was_betting_enabled := v_settings.betting_enabled;

  v_changed_fields := array[]::text[];
  if p_seed_amount is distinct from v_settings.seed_amount then v_changed_fields := array_append(v_changed_fields, 'seed_amount'); end if;
  if p_seasons_enabled is distinct from v_settings.seasons_enabled then v_changed_fields := array_append(v_changed_fields, 'seasons_enabled'); end if;
  if p_season_length is distinct from v_settings.season_length then v_changed_fields := array_append(v_changed_fields, 'season_length'); end if;
  if p_timezone is distinct from v_settings.timezone then v_changed_fields := array_append(v_changed_fields, 'timezone'); end if;
  if p_accepting_members is distinct from v_settings.accepting_members then v_changed_fields := array_append(v_changed_fields, 'accepting_members'); end if;
  if p_betting_enabled is distinct from v_settings.betting_enabled then v_changed_fields := array_append(v_changed_fields, 'betting_enabled'); end if;
  if p_season_custom_ends_at is distinct from v_settings.season_custom_ends_at then v_changed_fields := array_append(v_changed_fields, 'season_custom_ends_at'); end if;
  if v_join_message is distinct from v_settings.join_message then v_changed_fields := array_append(v_changed_fields, 'join_message'); end if;
  if p_awards_enabled is distinct from v_settings.awards_enabled then v_changed_fields := array_append(v_changed_fields, 'awards_enabled'); end if;
  if p_require_endorsement is distinct from v_settings.require_endorsement then v_changed_fields := array_append(v_changed_fields, 'require_endorsement'); end if;
  if p_allow_hedged_bets is distinct from v_settings.allow_hedged_bets then v_changed_fields := array_append(v_changed_fields, 'allow_hedged_bets'); end if;
  if p_distribute_payout is distinct from v_settings.distribute_payout then v_changed_fields := array_append(v_changed_fields, 'distribute_payout'); end if;
  if p_creator_payout_pct is distinct from v_settings.creator_payout_pct then v_changed_fields := array_append(v_changed_fields, 'creator_payout_pct'); end if;
  if p_resolution_window_hours is distinct from v_settings.resolution_window_hours then v_changed_fields := array_append(v_changed_fields, 'resolution_window_hours'); end if;
  if v_prize_text is distinct from v_settings.prize_text then v_changed_fields := array_append(v_changed_fields, 'prize_text'); end if;
  if v_punishment_text is distinct from v_settings.punishment_text then v_changed_fields := array_append(v_changed_fields, 'punishment_text'); end if;
  if p_login_reward_amount is distinct from v_settings.login_reward_amount then v_changed_fields := array_append(v_changed_fields, 'login_reward_amount'); end if; -- login reward

  v_advanced_changed := v_changed_fields && array['require_endorsement', 'allow_hedged_bets', 'distribute_payout', 'creator_payout_pct', 'resolution_window_hours', 'prize_text', 'punishment_text'];
  v_basic_changed := v_changed_fields && array['seed_amount', 'seasons_enabled', 'season_length', 'timezone', 'accepting_members', 'betting_enabled', 'season_custom_ends_at', 'join_message', 'awards_enabled', 'login_reward_amount'];

  if p_seed_amount is distinct from v_settings.seed_amount
     and (p_seed_amount is null or p_seed_amount < 1 or p_seed_amount > 1000000) then
    raise exception 'invalid_operation: the token allocation must be between 1 and 1,000,000';
  end if;

  -- login reward: same grandfathering rule as the allocation above -- only a value that actually
  -- changed is checked. Null is always fine (it means "use the default").
  if p_login_reward_amount is distinct from v_settings.login_reward_amount
     and p_login_reward_amount is not null
     and (p_login_reward_amount < 0 or p_login_reward_amount > 1000000) then
    raise exception 'invalid_operation: the login reward must be between 0 and 1,000,000';
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
      awards_enabled = p_awards_enabled,
      prize_text = v_prize_text,
      punishment_text = v_punishment_text,
      login_reward_amount = p_login_reward_amount
  where group_id = p_group_id
  returning * into v_settings;

  if array_length(v_changed_fields, 1) > 0 then
    insert into lifecycle_events (event_type, user_id, group_id, metadata)
    values (
      'settings_update',
      v_caller,
      p_group_id,
      jsonb_build_object(
        'changed_fields', to_jsonb(v_changed_fields),
        'basic_changed', v_basic_changed,
        'advanced_changed', v_advanced_changed
      )
    );
  end if;

  if p_seasons_enabled and not exists (select 1 from seasons where group_id = p_group_id) then
    v_ends_at := _compute_season_ends_at(p_season_length, p_season_custom_ends_at, now());
    insert into seasons (group_id, number, status, seed_amount, ends_at, season_length, betting_open)
    values (p_group_id, 1, 'active', p_seed_amount, v_ends_at, p_season_length, p_betting_enabled)
    returning id into v_season_id;

    update markets set season_id = v_season_id where group_id = p_group_id and season_id is null;
  end if;

  if p_betting_enabled and not v_was_betting_enabled then
    perform _emit_notification_event('betting_opened', p_group_id, null, null, v_caller);
  end if;

  return v_settings;
end;
$$;

revoke execute on function update_group_settings(uuid, int, boolean, season_length, text, boolean, boolean, boolean, int, boolean, timestamptz, numeric, boolean, text, boolean, text, text, int) from public;
grant execute on function update_group_settings(uuid, int, boolean, season_length, text, boolean, boolean, boolean, int, boolean, timestamptz, numeric, boolean, text, boolean, text, text, int) to authenticated;
