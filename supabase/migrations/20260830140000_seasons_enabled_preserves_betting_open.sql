-- update_group_settings, redeclared from
-- 20260825200000_public_group_universal_loss_and_mod_settings.sql with one
-- fix: turning seasons_enabled on used to always create season 1 with
-- betting_open = false, even for a group that already had betting_enabled =
-- true (i.e. was already taking bets continuously before switching to
-- seasons). That forced the owner to click "Open betting for this season"
-- immediately after flipping the switch, pausing a group that was already
-- live for no reason. Season 1 now inherits p_betting_enabled instead of a
-- hardcoded false: a brand-new group that has never turned betting on yet
-- still gets the original "see who's playing first" pause, but a group
-- switching to seasons mid-betting stays open. Same 15-arg signature, plain
-- CREATE OR REPLACE.
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
    values (p_group_id, 1, 'active', p_seed_amount, v_ends_at, p_season_length, p_betting_enabled);
  end if;

  if p_betting_enabled and not v_was_betting_enabled then
    perform _emit_notification_event('betting_opened', p_group_id, null, null, v_caller);
  end if;

  return v_settings;
end;
$$;

revoke execute on function update_group_settings(uuid, int, boolean, season_length, text, boolean, boolean, boolean, int, boolean, timestamptz, numeric, boolean, text, boolean) from public;
grant execute on function update_group_settings(uuid, int, boolean, season_length, text, boolean, boolean, boolean, int, boolean, timestamptz, numeric, boolean, text, boolean) to authenticated;
