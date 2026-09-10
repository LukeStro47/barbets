-- Function changes for the two new market_type values added in
-- 20260909300000_market_type_new_values.sql: most_likely_to and when (GitHub issue #87).
--
-- Both are multiple_choice underneath, so every function that branched on
-- market_type = 'multiple_choice' now branches on the new _is_option_market() helper instead,
-- and treats the three option-based types identically. Each redeclared body below was taken
-- from the chronologically latest migration defining that function (named above each one) and
-- changed only where the note says; nothing else in any body moved. See the stale-base lesson
-- under "Notable design decisions" in ARCHITECTURE.md for why that matters.
--
-- Two new helpers:
--   _is_option_market(market_type)      the one place that knows which types use market_options.
--   _when_option_labels(at, timezone)   the four fixed buckets a when market opens with, as plain
--                                       text carrying the concrete dates, computed off the creation
--                                       moment in the group's timezone (group_settings.timezone).
--
-- Deliberately untouched: is_market_visible() (reveal on resolve stays, settled 2026-09-09),
-- _create_system_market()/_resolve_system_market() (the pipelines have no use for either type and
-- keep their explicit yes_no/over_under/multiple_choice allowlist), and every notification path.

create or replace function _is_option_market(p_market_type market_type)
returns boolean
language sql
immutable
set search_path = public
as $$
  select p_market_type in ('multiple_choice', 'most_likely_to', 'when');
$$;

revoke execute on function _is_option_market(market_type) from public;
revoke execute on function _is_option_market(market_type) from authenticated;
grant execute on function _is_option_market(market_type) to service_role;

-- The three dated windows always nest (tonight < this weekend < this month), rolling a later
-- bucket forward when the calendar would otherwise collapse it into an earlier one: "this
-- weekend" on a Sunday means the coming one, and "this month" in a month's last few days means
-- the end of next month. Each label carries its concrete date so a market still reads
-- unambiguously long after "tonight" or "this weekend" stopped meaning anything.
create or replace function _when_option_labels(p_at timestamptz, p_timezone text)
returns text[]
language plpgsql
stable
set search_path = public
as $$
declare
  v_today date := (p_at at time zone p_timezone)::date;
  v_weekend date;
  v_month_end date;
begin
  v_weekend := v_today + ((7 - extract(isodow from v_today)::int) % 7);
  if v_weekend <= v_today then
    v_weekend := v_weekend + 7;
  end if;

  v_month_end := (date_trunc('month', v_today::timestamp) + interval '1 month - 1 day')::date;
  if v_month_end <= v_weekend then
    v_month_end := (date_trunc('month', v_month_end::timestamp) + interval '2 month - 1 day')::date;
  end if;

  return array[
    'Tonight (by end of ' || to_char(v_today, 'Dy Mon FMDD') || ')',
    'This weekend (by ' || to_char(v_weekend, 'Dy Mon FMDD') || ')',
    'This month (by ' || to_char(v_month_end, 'Dy Mon FMDD') || ')',
    'Never (not by ' || to_char(v_month_end, 'Mon FMDD') || ')'
  ];
end;
$$;

revoke execute on function _when_option_labels(timestamptz, text) from public;
revoke execute on function _when_option_labels(timestamptz, text) from authenticated;
grant execute on function _when_option_labels(timestamptz, text) to service_role;

-- ---------------------------------------------------------------------------------------------
-- create_market: base = 20260830180000_allow_sports_weather_mod_markets.sql
-- Changed: the branch condition, the when-bucket generation at the top of the branch, and the
-- most_likely_to all-@ check after the label checks. Every gate, raise, insert, and emit is
-- carried forward verbatim.

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

  if _is_option_market(p_market_type) then
    -- A when market's options are the four fixed time buckets, generated here off the creation
    -- moment in the group's timezone rather than sent by the client, so the labels are
    -- self-describing after the fact and every client renders the same windows. p_options is
    -- assigned in place (PL/pgSQL parameters are ordinary variables) so the option loop below
    -- stays byte-for-byte what it was.
    if p_market_type = 'when' then
      if coalesce(array_length(p_options, 1), 0) > 0 then
        raise exception 'invalid_operation: a when market uses fixed time buckets, it does not take custom options';
      end if;
      p_options := _when_option_labels(now(), v_settings.timezone);
    end if;

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

    -- Every most_likely_to option is a member: the roster picker only ever sends @nicknames, and
    -- the server holds that line so a hand-built call can't smuggle in a plain-text option that
    -- would sidestep the subject rules below.
    if p_market_type = 'most_likely_to'
       and exists (select 1 from unnest(p_options) as o where left(trim(o), 1) <> '@') then
      raise exception 'invalid_operation: every option in a most likely to market has to be a member of the group';
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

-- ---------------------------------------------------------------------------------------------
-- place_bet: base = 20260829130000_lifecycle_event_instrumentation.sql
-- Changed: the branch condition only.

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

  if _is_option_market(v_market.market_type) then
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

-- ---------------------------------------------------------------------------------------------
-- propose_resolution: base = 20260830290000_restore_propose_resolution_mod_gate.sql
-- Changed: the branch condition only.

create or replace function propose_resolution(
  p_market_id uuid,
  p_outcome market_outcome,
  p_justification text default null,
  p_actual_value numeric default null,
  p_option_id uuid default null,
  p_photo_path text default null
) returns resolution_proposals
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_market markets%rowtype;
  v_proposal resolution_proposals%rowtype;
  v_is_public boolean;
begin
  select * into v_market from markets where id = p_market_id for update;
  if v_market.id is null then
    raise exception 'not_found: market not found';
  end if;

  if exists (select 1 from market_subjects where market_id = p_market_id and user_id = v_user_id) then
    raise exception 'not_found: market not found';
  end if;

  perform 1 from memberships where group_id = v_market.group_id and user_id = v_user_id and status <> 'removed';
  if not found then
    raise exception 'not_found: not a member of this group';
  end if;

  select is_public into v_is_public from groups where id = v_market.group_id;
  if v_is_public and not _is_group_mod_or_owner(v_market.group_id, v_user_id) then
    raise exception 'forbidden: only a moderator can resolve a market in this group';
  end if;

  if v_market.status not in ('open', 'closed') then
    raise exception 'invalid_operation: market is not awaiting a resolution proposal';
  end if;

  if _is_option_market(v_market.market_type) then
    if p_option_id is not null then
      if p_outcome is not null then
        raise exception 'invalid_operation: propose an option or VOID, not both';
      end if;
      perform 1 from market_options where id = p_option_id and market_id = p_market_id;
      if not found then
        raise exception 'invalid_operation: option does not belong to this market';
      end if;
    elsif p_outcome is distinct from 'void' then
      raise exception 'invalid_operation: outcome does not match market type';
    end if;
  else
    if p_option_id is not null then
      raise exception 'invalid_operation: this market does not use options';
    end if;
    if (v_market.market_type = 'yes_no' and p_outcome not in ('yes', 'no', 'void'))
       or (v_market.market_type = 'over_under' and p_outcome not in ('over', 'under', 'void')) then
      raise exception 'invalid_operation: outcome does not match market type';
    end if;
  end if;

  if p_actual_value is not null and v_market.market_type <> 'over_under' then
    raise exception 'invalid_operation: actual_value only applies to over/under markets';
  end if;

  insert into resolution_proposals (market_id, proposer_id, proposed_outcome, justification, actual_value, proposed_option_id, photo_path)
  values (p_market_id, v_user_id, p_outcome, p_justification, p_actual_value, p_option_id, p_photo_path)
  returning * into v_proposal;

  update markets
  set status = 'proposed', closed_at = coalesce(closed_at, now())
  where id = p_market_id;

  if v_is_public then
    perform finalize_market(p_market_id);
  else
    perform _emit_notification_event('resolution_proposed', v_market.group_id, p_market_id, null, v_user_id);
  end if;

  return v_proposal;
end;
$$;

revoke execute on function propose_resolution(uuid, market_outcome, text, numeric, uuid, text) from public;
grant execute on function propose_resolution(uuid, market_outcome, text, numeric, uuid, text) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- cast_vote: base = 20260721130000_resolution_window_setting.sql
-- Changed: the branch condition only.

create or replace function cast_vote(p_market_id uuid, p_outcome market_outcome, p_option_id uuid default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_market markets%rowtype;
  v_settings group_settings%rowtype;
  v_challenge challenges%rowtype;
  v_eligible_voters int;
  v_votes_cast int;
begin
  select * into v_market from markets where id = p_market_id;
  if v_market.id is null then
    raise exception 'not_found: market not found';
  end if;

  if exists (select 1 from market_subjects where market_id = p_market_id and user_id = v_user_id) then
    raise exception 'not_found: market not found';
  end if;

  perform 1 from memberships where group_id = v_market.group_id and user_id = v_user_id and status <> 'removed';
  if not found then
    raise exception 'not_found: not a member of this group';
  end if;

  if v_market.status <> 'disputed' then
    raise exception 'invalid_operation: market is not open for voting';
  end if;

  select * into v_settings from group_settings where group_id = v_market.group_id;
  select * into v_challenge from challenges where market_id = p_market_id;
  if v_challenge.created_at + (v_settings.resolution_window_hours * interval '1 hour') <= now() then
    raise exception 'invalid_operation: voting has closed';
  end if;

  if _is_option_market(v_market.market_type) then
    if p_option_id is not null then
      if p_outcome is not null then
        raise exception 'invalid_operation: choose an option or VOID, not both';
      end if;
      perform 1 from market_options where id = p_option_id and market_id = p_market_id;
      if not found then
        raise exception 'invalid_operation: option does not belong to this market';
      end if;
    elsif p_outcome is distinct from 'void' then
      raise exception 'invalid_operation: outcome does not match market type';
    end if;
  else
    if p_option_id is not null then
      raise exception 'invalid_operation: this market does not use options';
    end if;
    if (v_market.market_type = 'yes_no' and p_outcome not in ('yes', 'no', 'void'))
       or (v_market.market_type = 'over_under' and p_outcome not in ('over', 'under', 'void')) then
      raise exception 'invalid_operation: outcome does not match market type';
    end if;
  end if;

  insert into votes (market_id, voter_id, outcome, voted_option_id)
  values (p_market_id, v_user_id, p_outcome, p_option_id)
  on conflict (market_id, voter_id) do update set outcome = excluded.outcome, voted_option_id = excluded.voted_option_id, created_at = now();

  select count(*) into v_eligible_voters
  from memberships m
  where m.group_id = v_market.group_id
    and m.status <> 'removed'
    and not exists (select 1 from market_subjects ms where ms.market_id = p_market_id and ms.user_id = m.user_id);

  select count(distinct voter_id) into v_votes_cast from votes where market_id = p_market_id;

  if v_votes_cast >= v_eligible_voters then
    perform finalize_market(p_market_id);
  end if;
end;
$$;

revoke execute on function cast_vote(uuid, market_outcome, uuid) from public;
grant execute on function cast_vote(uuid, market_outcome, uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- _finalize_market_core: base = 20260830260000_no_impressive_bet_public_groups.sql
-- Changed: the two market_type comparisons (vote-tally outcome mapping, winning bet side) only.

create or replace function _finalize_market_core(p_market_id uuid)
returns markets
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_id uuid := auth.uid();
  v_market markets%rowtype;
  v_settings group_settings%rowtype;
  v_proposal resolution_proposals%rowtype;
  v_challenge challenges%rowtype;
  v_outcome market_outcome;
  v_outcome_option_id uuid;
  v_winning_bet_side bet_side;
  v_actual_value numeric;
  v_top_key text;
  v_top_count int;
  v_tied_keys text[];
  v_proposed_key text;
  v_eligible_voters int;
  v_votes_cast int;
  v_total_pool bigint;
  v_winning_pool bigint;
  v_real_pool bigint;
  v_creator_cut bigint;
  v_remainder bigint;
  v_other_markets_cut bigint;
  v_held_in_group_pool bigint;
  v_other_market_ids uuid[];
  v_n int;
  v_share bigint;
  v_dust bigint;
  v_best_bet_id uuid;
  v_best_bet_user_id uuid;
  v_is_public boolean;
  rec record;
begin
  select * into v_market from markets where id = p_market_id for update;
  if v_market.id is null then
    raise exception 'not_found: market not found';
  end if;

  if v_market.status not in ('proposed', 'disputed') then
    raise exception 'invalid_operation: market is not awaiting finalization';
  end if;

  select * into v_settings from group_settings where group_id = v_market.group_id;
  select is_public into v_is_public from groups where id = v_market.group_id;

  select * into v_proposal from resolution_proposals where market_id = p_market_id;
  if v_proposal.id is null then
    raise exception 'invalid_operation: no proposal exists for this market';
  end if;

  if v_market.status = 'proposed' then
    if not v_is_public and v_proposal.proposed_at + (v_settings.resolution_window_hours * interval '1 hour') > now() then
      raise exception 'invalid_operation: the challenge window is still open';
    end if;
    v_outcome := v_proposal.proposed_outcome;
    v_outcome_option_id := v_proposal.proposed_option_id;
    v_actual_value := v_proposal.actual_value;
  else
    select * into v_challenge from challenges where market_id = p_market_id;

    select count(*) into v_eligible_voters
    from memberships m
    where m.group_id = v_market.group_id
      and m.status <> 'removed'
      and not exists (select 1 from market_subjects ms where ms.market_id = p_market_id and ms.user_id = m.user_id);
    select count(distinct voter_id) into v_votes_cast from votes where market_id = p_market_id;

    if v_challenge.created_at + (v_settings.resolution_window_hours * interval '1 hour') > now() and v_votes_cast < v_eligible_voters then
      raise exception 'invalid_operation: the vote window is still open';
    end if;

    select coalesce(voted_option_id::text, outcome::text), count(*) into v_top_key, v_top_count
    from votes
    where market_id = p_market_id
    group by 1
    order by count(*) desc
    limit 1;

    v_proposed_key := coalesce(v_proposal.proposed_option_id::text, v_proposal.proposed_outcome::text);

    if v_top_count is null or v_top_count = 0 then
      v_top_key := v_proposed_key;
    else
      select array_agg(key) into v_tied_keys
      from (
        select coalesce(voted_option_id::text, outcome::text) as key
        from votes
        where market_id = p_market_id
        group by 1
        having count(*) = v_top_count
      ) ties;

      if array_length(v_tied_keys, 1) > 1 then
        if v_proposed_key = any(v_tied_keys) then
          v_top_key := v_proposed_key;
        else
          v_top_key := 'void';
        end if;
      end if;
    end if;

    if v_top_key = 'void' then
      v_outcome := 'void';
      v_outcome_option_id := null;
    elsif _is_option_market(v_market.market_type) then
      v_outcome := null;
      v_outcome_option_id := v_top_key::uuid;
    else
      v_outcome := v_top_key::market_outcome;
      v_outcome_option_id := null;
    end if;

    v_actual_value := v_proposal.actual_value;

    update resolution_proposals set votes_revealed_at = now() where market_id = p_market_id;
  end if;

  update resolution_proposals set finalized = true where market_id = p_market_id;

  if v_outcome = 'void' then
    perform refund_all_bets(p_market_id);
    update markets
    set status = 'voided', outcome = 'void', outcome_option_id = null, actual_value = v_actual_value, resolved_at = now()
    where id = p_market_id
    returning * into v_market;
    perform _emit_notification_event('market_resolved', v_market.group_id, v_market.id, null, v_actor_id);
    return v_market;
  end if;

  v_winning_bet_side := case when _is_option_market(v_market.market_type) then null else v_outcome::text::bet_side end;

  select coalesce(sum(amount), 0) into v_total_pool
  from bets where market_id = p_market_id and settled_at is null;

  select coalesce(sum(amount), 0) into v_winning_pool
  from bets
  where market_id = p_market_id and settled_at is null
    and (side = v_winning_bet_side or option_id = v_outcome_option_id);

  if v_winning_pool = 0 then
    if not v_settings.distribute_payout or v_total_pool + v_market.bonus_pool = 0 then
      perform refund_all_bets(p_market_id);
      update markets
      set status = 'resolved', outcome = v_outcome, outcome_option_id = v_outcome_option_id, actual_value = v_actual_value, resolved_at = now()
      where id = p_market_id
      returning * into v_market;
      perform _emit_notification_event('market_resolved', v_market.group_id, v_market.id, null, v_actor_id);
      perform _bump_titles_counter(v_market.group_id);
      return v_market;
    end if;

    v_real_pool := v_total_pool;
    v_creator_cut := floor(v_real_pool::numeric * v_settings.creator_payout_pct / 100)::bigint;
    v_remainder := v_real_pool + v_market.bonus_pool - v_creator_cut;
    v_other_markets_cut := 0;
    v_held_in_group_pool := 0;

    if v_creator_cut > 0 then
      update memberships set balance = balance + v_creator_cut
      where group_id = v_market.group_id and user_id = v_market.creator_id;

      insert into ledger (membership_id, amount, reason, market_id)
      select id, v_creator_cut, 'payout', p_market_id
      from memberships where group_id = v_market.group_id and user_id = v_market.creator_id;
    end if;

    update markets set bonus_pool = 0 where id = p_market_id;

    if v_remainder = 0 then
      update bets set payout = 0, settled_at = now() where market_id = p_market_id and settled_at is null;
    else
      select array_agg(id order by created_at asc, id asc) into v_other_market_ids
      from markets where group_id = v_market.group_id and status = 'open';

      if v_other_market_ids is not null and array_length(v_other_market_ids, 1) > 0 then
        v_other_markets_cut := v_remainder;
        v_n := array_length(v_other_market_ids, 1);
        v_share := floor(v_remainder::numeric / v_n)::bigint;
        v_dust := v_remainder - v_share * v_n;

        update markets
        set bonus_pool = bonus_pool + v_share + (case when id = v_other_market_ids[1] then v_dust else 0 end)
        where id = any(v_other_market_ids);
      else
        v_held_in_group_pool := v_remainder;
        update groups set pending_bonus_pool = pending_bonus_pool + v_remainder where id = v_market.group_id;
      end if;

      update bets set payout = 0, settled_at = now() where market_id = p_market_id and settled_at is null;
    end if;

    update markets
    set status = 'resolved', outcome = v_outcome, outcome_option_id = v_outcome_option_id, actual_value = v_actual_value, resolved_at = now(),
        payout_breakdown = jsonb_build_object(
          'creator_cut', v_creator_cut,
          'endorser_cut', 0,
          'other_markets_cut', v_other_markets_cut,
          'held_in_group_pool', v_held_in_group_pool
        )
    where id = p_market_id
    returning * into v_market;
    perform _emit_notification_event('market_resolved', v_market.group_id, v_market.id, null, v_actor_id);
    perform _bump_titles_counter(v_market.group_id);
    return v_market;
  end if;

  for rec in
    with winners as (
      select b.id, b.user_id, b.amount, b.created_at,
             floor(b.amount::numeric * (v_total_pool + v_market.bonus_pool) / v_winning_pool)::bigint as base_payout
      from bets b
      where b.market_id = p_market_id and b.settled_at is null
        and (b.side = v_winning_bet_side or b.option_id = v_outcome_option_id)
    ),
    dust as (
      select (v_total_pool + v_market.bonus_pool) - coalesce(sum(base_payout), 0) as amount from winners
    ),
    ranked as (
      select w.*, row_number() over (order by w.amount desc, w.created_at asc, w.id asc) as rn
      from winners w
    ),
    computed as (
      select r.id, r.user_id, r.base_payout + (case when r.rn = 1 then d.amount else 0 end) as payout
      from ranked r cross join dust d
    )
    update bets b
    set payout = c.payout, settled_at = now()
    from computed c
    where b.id = c.id
    returning b.id, b.user_id, b.payout
  loop
    update memberships
    set balance = balance + rec.payout
    where group_id = v_market.group_id and user_id = rec.user_id;

    insert into ledger (membership_id, amount, reason, market_id, bet_id)
    select id, rec.payout, 'payout', p_market_id, rec.id
    from memberships
    where group_id = v_market.group_id and user_id = rec.user_id;
  end loop;

  update bets set payout = 0, settled_at = now()
  where market_id = p_market_id and settled_at is null;

  update markets
  set status = 'resolved', outcome = v_outcome, outcome_option_id = v_outcome_option_id, actual_value = v_actual_value, resolved_at = now(), bonus_pool = 0
  where id = p_market_id
  returning * into v_market;

  perform _emit_notification_event('market_resolved', v_market.group_id, v_market.id, null, v_actor_id);
  perform _bump_titles_counter(v_market.group_id);

  select b.id, b.user_id into v_best_bet_id, v_best_bet_user_id
  from bets b
  join markets mk on mk.id = b.market_id
  where mk.group_id = v_market.group_id
    and b.settled_at is not null
    and b.payout > b.amount
  order by (b.payout::numeric / b.amount) desc, b.settled_at desc
  limit 1;

  perform _upsert_risk_taker(v_market.group_id);

  -- Public groups skip the impressive-bet push -- see the header comment. Left computed above
  -- either way since it's a cheap read and this keeps the "does this market's winning bet
  -- qualify" logic identical for both group types.
  if not v_is_public and v_best_bet_id is not null and exists (select 1 from bets where id = v_best_bet_id and market_id = p_market_id) then
    perform _emit_notification_event('impressive_bet', v_market.group_id, p_market_id, null, v_best_bet_user_id);
  end if;

  return v_market;
end;
$$;

revoke execute on function _finalize_market_core(uuid) from public;
revoke execute on function _finalize_market_core(uuid) from authenticated;

-- ---------------------------------------------------------------------------------------------
-- _recompute_group_titles: base = 20260824130000_awards_enabled_gate.sql
-- Changed: the two `won` case expressions only.

create or replace function _recompute_group_titles(p_group_id uuid, p_notify boolean default true)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_awards_enabled boolean;
  v_changed boolean := false;
  v_old_holder uuid;
  v_new_holder uuid;
  v_new_value double precision;
begin
  select awards_enabled into v_awards_enabled from group_settings where group_id = p_group_id;
  if not coalesce(v_awards_enabled, true) then
    return;
  end if;

  -- The Oracle: highest win rate, min. 5 settled real bets.
  select b.user_id, avg(b.won::int)::numeric
  into v_new_holder, v_new_value
  from (
    select bt.user_id,
      case when _is_option_market(m.market_type) then bt.option_id = m.outcome_option_id else bt.side = m.outcome::text::bet_side end as won
    from bets bt
    join markets m on m.id = bt.market_id
    join memberships mem on mem.group_id = m.group_id and mem.user_id = bt.user_id and mem.status <> 'removed'
    where m.group_id = p_group_id and m.status = 'resolved'
  ) b
  group by b.user_id
  having count(*) >= 5
  order by avg(b.won::int) desc, count(*) desc, b.user_id
  limit 1;

  select user_id into v_old_holder from group_titles where group_id = p_group_id and title_key = 'oracle';
  insert into group_titles (group_id, title_key, user_id, stat_value, computed_at)
  values (p_group_id, 'oracle', v_new_holder, v_new_value, now())
  on conflict (group_id, title_key) do update set user_id = excluded.user_id, stat_value = excluded.stat_value, computed_at = excluded.computed_at;
  if v_new_holder is distinct from v_old_holder then v_changed := true; end if;

  -- Ice Cold: lowest win rate, same eligibility.
  select b.user_id, avg(b.won::int)::numeric
  into v_new_holder, v_new_value
  from (
    select bt.user_id,
      case when _is_option_market(m.market_type) then bt.option_id = m.outcome_option_id else bt.side = m.outcome::text::bet_side end as won
    from bets bt
    join markets m on m.id = bt.market_id
    join memberships mem on mem.group_id = m.group_id and mem.user_id = bt.user_id and mem.status <> 'removed'
    where m.group_id = p_group_id and m.status = 'resolved'
  ) b
  group by b.user_id
  having count(*) >= 5
  order by avg(b.won::int) asc, count(*) desc, b.user_id
  limit 1;

  select user_id into v_old_holder from group_titles where group_id = p_group_id and title_key = 'ice_cold';
  insert into group_titles (group_id, title_key, user_id, stat_value, computed_at)
  values (p_group_id, 'ice_cold', v_new_holder, v_new_value, now())
  on conflict (group_id, title_key) do update set user_id = excluded.user_id, stat_value = excluded.stat_value, computed_at = excluded.computed_at;
  if v_new_holder is distinct from v_old_holder then v_changed := true; end if;

  -- Degenerate: most bets ever placed (any status, not just resolved).
  select bt.user_id, count(*)::numeric
  into v_new_holder, v_new_value
  from bets bt
  join markets m on m.id = bt.market_id
  join memberships mem on mem.group_id = m.group_id and mem.user_id = bt.user_id and mem.status <> 'removed'
  where m.group_id = p_group_id
  group by bt.user_id
  order by count(*) desc, bt.user_id
  limit 1;

  select user_id into v_old_holder from group_titles where group_id = p_group_id and title_key = 'degenerate';
  insert into group_titles (group_id, title_key, user_id, stat_value, computed_at)
  values (p_group_id, 'degenerate', v_new_holder, v_new_value, now())
  on conflict (group_id, title_key) do update set user_id = excluded.user_id, stat_value = excluded.stat_value, computed_at = excluded.computed_at;
  if v_new_holder is distinct from v_old_holder then v_changed := true; end if;

  if v_changed and p_notify then
    perform _emit_notification_event('group_titles_updated', p_group_id);
  end if;
end;
$$;

revoke execute on function _recompute_group_titles(uuid, boolean) from public;

-- ---------------------------------------------------------------------------------------------
-- get_subject_market_pulse_sides: base = 20260805140500_market_opened_about_you.sql
-- Changed: the refusal condition and its message only. A subject of a most_likely_to or when
-- market gets the aggregate pulse and nothing per option, same as multiple_choice.

create or replace function get_subject_market_pulse_sides(p_market_id uuid)
returns table (side bet_side, pool_amount bigint, bet_count bigint, pool_percent numeric)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_market markets%rowtype;
  v_total bigint;
  v_sides bet_side[];
begin
  select * into v_market from markets where id = p_market_id;
  if v_market.id is null then
    raise exception 'not_found: market not found';
  end if;

  perform 1 from memberships where group_id = v_market.group_id and user_id = v_user_id and status <> 'removed';
  if not found then
    raise exception 'not_found: market not found';
  end if;

  if not exists (select 1 from market_subjects where market_id = p_market_id and user_id = v_user_id) then
    raise exception 'not_found: market not found';
  end if;

  if v_market.status in ('resolved', 'voided') then
    raise exception 'not_found: market not found';
  end if;

  if _is_option_market(v_market.market_type) then
    raise exception 'invalid_operation: no side breakdown for option-based markets';
  end if;

  v_sides := case v_market.market_type
    when 'yes_no' then array['yes', 'no']::bet_side[]
    else array['over', 'under']::bet_side[]
  end;

  select coalesce(sum(b.amount), 0) into v_total from bets b where b.market_id = p_market_id;

  return query
  select
    s as side,
    coalesce(sum(b.amount), 0)::bigint as pool_amount,
    count(b.id) as bet_count,
    case when v_total = 0 then 0
         else round(coalesce(sum(b.amount), 0)::numeric * 100 / v_total, 1)
    end as pool_percent
  from unnest(v_sides) as s
  left join bets b on b.market_id = p_market_id and b.side = s
  group by s
  order by s;
end;
$$;

revoke execute on function get_subject_market_pulse_sides(uuid) from public;
grant execute on function get_subject_market_pulse_sides(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- get_closed_odds: base = 20260708112000_multiple_choice_functions.sql
-- Changed: the refusal condition and its message only.

create or replace function get_closed_odds(p_market_id uuid)
returns table (side bet_side, pool_amount bigint, bet_count bigint, pool_percent numeric)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_market markets%rowtype;
  v_total bigint;
  v_sides bet_side[];
begin
  if not is_market_visible(p_market_id) then
    raise exception 'not_found: market not found';
  end if;

  select * into v_market from markets where id = p_market_id;

  if _is_option_market(v_market.market_type) then
    raise exception 'invalid_operation: use get_closed_odds_options for option-based markets';
  end if;

  if v_market.status in ('pending_sponsor', 'open') then
    raise exception 'invalid_operation: odds are not available until betting closes';
  end if;

  v_sides := case v_market.market_type
    when 'yes_no' then array['yes', 'no']::bet_side[]
    else array['over', 'under']::bet_side[]
  end;

  select coalesce(sum(b.amount), 0) into v_total from bets b where b.market_id = p_market_id;

  return query
  select
    s as side,
    coalesce(sum(b.amount), 0)::bigint as pool_amount,
    count(b.id) as bet_count,
    case when v_total = 0 then 0
         else round(coalesce(sum(b.amount), 0)::numeric * 100 / v_total, 1)
    end as pool_percent
  from unnest(v_sides) as s
  left join bets b on b.market_id = p_market_id and b.side = s
  group by s
  order by s;
end;
$$;

revoke execute on function get_closed_odds(uuid) from public;
grant execute on function get_closed_odds(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- get_closed_odds_options: base = 20260708112000_multiple_choice_functions.sql
-- Changed: the refusal condition only.

create or replace function get_closed_odds_options(p_market_id uuid)
returns table (option_id uuid, label text, sort_order int, pool_amount bigint, bet_count bigint, pool_percent numeric)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_market markets%rowtype;
  v_total bigint;
begin
  if not is_market_visible(p_market_id) then
    raise exception 'not_found: market not found';
  end if;

  select * into v_market from markets where id = p_market_id;

  if not _is_option_market(v_market.market_type) then
    raise exception 'invalid_operation: this market does not use options';
  end if;

  if v_market.status in ('pending_sponsor', 'open') then
    raise exception 'invalid_operation: odds are not available until betting closes';
  end if;

  select coalesce(sum(b.amount), 0) into v_total from bets b where b.market_id = p_market_id;

  return query
  select
    mo.id as option_id,
    mo.label,
    mo.sort_order,
    coalesce(sum(b.amount), 0)::bigint as pool_amount,
    count(b.id) as bet_count,
    case when v_total = 0 then 0
         else round(coalesce(sum(b.amount), 0)::numeric * 100 / v_total, 1)
    end as pool_percent
  from market_options mo
  left join bets b on b.option_id = mo.id
  where mo.market_id = p_market_id
  group by mo.id, mo.label, mo.sort_order
  order by mo.sort_order;
end;
$$;

revoke execute on function get_closed_odds_options(uuid) from public;
grant execute on function get_closed_odds_options(uuid) to authenticated;
