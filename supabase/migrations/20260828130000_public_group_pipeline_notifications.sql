-- Four fixes to Sports/Weather public-group notification behavior, found from live use:
--
-- 1. A public group can run into the hundreds of members, and most of them never touch any one
--    given market. Nobody should get a "betting just closed" or resolution push about a market
--    they never bet on. market_opened is exempt -- that's the invitation to bet in the first
--    place, sent before anyone could have.
-- 2. system_markets_opened (previous migration) needs wiring into the category map, the
--    market-optional check constraint, and get_event_recipients' broad group-scoped branch.
-- 3. _create_system_market() no longer emits market_opened itself -- the calling Edge Function
--    now decides, once per run, via the new _notify_system_markets_created().
-- 4. Weather resolves a market within minutes of its own close (the observation needed to
--    resolve it is already knowable the moment closes_at arrives), unlike sports (which closes at
--    kickoff and only resolves once the game is actually over, hours later). A "betting just
--    closed, odds are live" push that arrives moments before "here's how it resolved" isn't a
--    heads up, it's noise -- so expire_stale() skips market_closed for Weather specifically. Sports
--    keeps it, since there's a real live-game gap for it to be meaningful during.
-- 5. Sports and Weather are pipeline-only boards -- create_market() now rejects hand-creating a
--    market there outright, for a moderator or the owner same as anyone else, not just regular
--    members. Matched by name the same way both pipelines' own Edge Functions already look their
--    group up (there is no rename feature for any group's name, so this is stable).

alter table notification_events drop constraint notification_events_market_events_have_market;
alter table notification_events add constraint notification_events_market_events_have_market check (
  (event_type in (
    'season_ended', 'betting_opened', 'member_joined',
    'group_deletion_scheduled', 'group_deletion_canceled', 'group_titles_updated',
    'season_betting_opened', 'group_deletion_scheduled_inactivity', 'admin_broadcast',
    'weekend_nudge', 'group_deletion_notice_14d', 'group_deletion_notice_7d', 'group_deletion_notice_1d',
    'assigned_group_moderator', 'system_markets_opened'
  ))
  or (market_id is not null)
);

create or replace function _notification_category(p_event_type notification_event_type)
returns text
language sql
immutable
set search_path = public
as $$
  select case p_event_type::text
    when 'market_needs_endorsement' then 'markets'
    when 'market_opened' then 'markets'
    when 'market_opened_about_you' then 'markets'
    when 'market_closed' then 'markets'
    when 'system_markets_opened' then 'markets'

    when 'resolution_proposed' then 'results'
    when 'resolution_challenged' then 'results'
    when 'market_resolved' then 'results'
    when 'market_voided' then 'results'
    when 'clarification_requested' then 'results'
    when 'criteria_updated' then 'results'
    when 'impressive_bet' then 'results'
    when 'group_titles_updated' then 'results'

    when 'member_joined' then 'admin'
    when 'betting_opened' then 'admin'
    when 'season_betting_opened' then 'admin'
    when 'season_ended' then 'admin'
    when 'group_deletion_scheduled' then 'admin'
    when 'group_deletion_canceled' then 'admin'
    when 'group_deletion_scheduled_inactivity' then 'admin'
    when 'group_deletion_notice_14d' then 'admin'
    when 'group_deletion_notice_7d' then 'admin'
    when 'group_deletion_notice_1d' then 'admin'
    when 'assigned_group_moderator' then 'admin'

    when 'weekend_nudge' then 'nudges'
    when 'market_closing_soon' then 'nudges'

    -- The only channel that exists purely to market at someone.
    when 'admin_broadcast' then 'promos'

    else 'other'
  end;
$$;

-- get_event_recipients: identical to 20260825150000's version except
-- (a) system_markets_opened joins the group-scoped, no-actor-exclusion-needed list alongside
--     betting_opened/season_ended, and
-- (b) the catch-all "else" branch (market_closed, resolution_proposed, resolution_challenged,
--     market_resolved, market_voided, criteria_updated) now excludes anyone who hasn't bet on the
--     market, for a public group only. market_opened stays exempt -- see the header comment.
create or replace function get_event_recipients(p_event_id uuid)
returns table (user_id uuid)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_event notification_events%rowtype;
  v_category text;
begin
  select * into v_event from notification_events where id = p_event_id;
  if v_event.id is null then
    return;
  end if;

  v_category := _notification_category(v_event.event_type);

  if v_event.event_type = 'member_joined' then
    return query
    select g.owner_id as user_id
    from groups g
    join memberships mem on mem.group_id = g.id and mem.user_id = g.owner_id and mem.status <> 'removed'
    join push_subscriptions ps on ps.user_id = g.owner_id
    join users u on u.id = g.owner_id and u.notifications_enabled = true
    where g.id = v_event.group_id
      and (v_event.actor_id is null or g.owner_id <> v_event.actor_id)
      and _prefs_allow(v_category, mem.notify_group, mem.notify_markets, mem.notify_results, mem.notify_admin, u.notify_nudges, u.notify_promos)
    group by g.owner_id;
  elsif v_event.event_type in ('impressive_bet', 'assigned_group_moderator') then
    return query
    select u.id as user_id
    from users u
    join memberships mem on mem.group_id = v_event.group_id and mem.user_id = u.id and mem.status <> 'removed'
    join push_subscriptions ps on ps.user_id = u.id
    where u.id = v_event.actor_id and u.notifications_enabled = true
      and _prefs_allow(v_category, mem.notify_group, mem.notify_markets, mem.notify_results, mem.notify_admin, u.notify_nudges, u.notify_promos)
    group by u.id;
  elsif v_event.event_type = 'clarification_requested' then
    return query
    select m.creator_id as user_id
    from markets m
    join memberships mem on mem.group_id = m.group_id and mem.user_id = m.creator_id and mem.status <> 'removed'
    join push_subscriptions ps on ps.user_id = m.creator_id
    join users u on u.id = m.creator_id and u.notifications_enabled = true
    where m.id = v_event.market_id
      and (v_event.actor_id is null or m.creator_id <> v_event.actor_id)
      and _prefs_allow(v_category, mem.notify_group, mem.notify_markets, mem.notify_results, mem.notify_admin, u.notify_nudges, u.notify_promos)
    group by m.creator_id;
  elsif v_event.event_type = 'market_opened_about_you' then
    return query
    select ms.user_id
    from market_subjects ms
    join memberships mem on mem.group_id = v_event.group_id and mem.user_id = ms.user_id and mem.status = 'active'
    join push_subscriptions ps on ps.user_id = ms.user_id
    join users u on u.id = ms.user_id and u.notifications_enabled = true
    where ms.market_id = v_event.market_id
      and (v_event.actor_id is null or ms.user_id <> v_event.actor_id)
      and _prefs_allow(v_category, mem.notify_group, mem.notify_markets, mem.notify_results, mem.notify_admin, u.notify_nudges, u.notify_promos)
    group by ms.user_id;
  elsif v_event.event_type = 'weekend_nudge' then
    return query
    select mem.user_id
    from memberships mem
    join push_subscriptions ps on ps.user_id = mem.user_id
    join users u on u.id = mem.user_id and u.notifications_enabled = true
    where mem.group_id = v_event.group_id
      and mem.status = 'active'
      and _prefs_allow(v_category, mem.notify_group, mem.notify_markets, mem.notify_results, mem.notify_admin, u.notify_nudges, u.notify_promos)
    group by mem.user_id;
  elsif v_event.event_type = 'market_closing_soon' then
    return query
    select mem.user_id
    from memberships mem
    join push_subscriptions ps on ps.user_id = mem.user_id
    join users u on u.id = mem.user_id and u.notifications_enabled = true
    where mem.group_id = v_event.group_id
      and mem.status = 'active'
      and not exists (
        select 1 from market_subjects ms where ms.market_id = v_event.market_id and ms.user_id = mem.user_id
      )
      and not exists (
        select 1 from bets b where b.market_id = v_event.market_id and b.user_id = mem.user_id
      )
      and not exists (
        select 1
        from bets b
        join markets mk on mk.id = b.market_id
        where mk.group_id = v_event.group_id
          and b.user_id = mem.user_id
          and b.created_at > now() - interval '7 days'
      )
      and _prefs_allow(v_category, mem.notify_group, mem.notify_markets, mem.notify_results, mem.notify_admin, u.notify_nudges, u.notify_promos)
    group by mem.user_id;
  elsif v_event.event_type = 'admin_broadcast' then
    return query
    select mem.user_id
    from memberships mem
    join push_subscriptions ps on ps.user_id = mem.user_id
    join users u on u.id = mem.user_id and u.notifications_enabled = true
    where mem.group_id = v_event.group_id
      and mem.status <> 'removed'
      and (
        (v_event.target_user_id is not null and mem.user_id = v_event.target_user_id)
        or (v_event.target_user_id is null and (v_event.actor_id is null or mem.user_id <> v_event.actor_id))
      )
      and _prefs_allow(v_category, mem.notify_group, mem.notify_markets, mem.notify_results, mem.notify_admin, u.notify_nudges, u.notify_promos)
    group by mem.user_id;
  elsif v_event.event_type in (
    'season_ended', 'betting_opened', 'group_deletion_scheduled', 'group_deletion_canceled', 'group_titles_updated',
    'season_betting_opened', 'group_deletion_scheduled_inactivity',
    'group_deletion_notice_14d', 'group_deletion_notice_7d', 'group_deletion_notice_1d', 'system_markets_opened'
  ) then
    return query
    select mem.user_id
    from memberships mem
    join push_subscriptions ps on ps.user_id = mem.user_id
    join users u on u.id = mem.user_id and u.notifications_enabled = true
    where mem.group_id = v_event.group_id
      and mem.status <> 'removed'
      and (v_event.actor_id is null or mem.user_id <> v_event.actor_id)
      and _prefs_allow(v_category, mem.notify_group, mem.notify_markets, mem.notify_results, mem.notify_admin, u.notify_nudges, u.notify_promos)
    group by mem.user_id;
  else
    return query
    select gnr.user_id
    from get_notification_recipients(v_event.market_id, v_event.event_type in ('market_resolved', 'market_voided')) gnr
    join memberships mem on mem.group_id = v_event.group_id and mem.user_id = gnr.user_id
    join users u on u.id = gnr.user_id
    where (v_event.actor_id is null or gnr.user_id <> v_event.actor_id)
      and _prefs_allow(v_category, mem.notify_group, mem.notify_markets, mem.notify_results, mem.notify_admin, u.notify_nudges, u.notify_promos)
      -- A public group's roster doesn't all care about one specific market the way a small
      -- private group's does -- restrict every post-open event to people who actually bet on
      -- this market. market_opened is the invitation to bet in the first place, sent before
      -- anyone could have, so it stays unrestricted.
      and (
        v_event.event_type = 'market_opened'
        or not exists (select 1 from groups g where g.id = v_event.group_id and g.is_public)
        or exists (select 1 from bets b where b.market_id = v_event.market_id and b.user_id = gnr.user_id)
      );
  end if;
end;
$$;

revoke execute on function get_event_recipients(uuid) from public;
revoke execute on function get_event_recipients(uuid) from authenticated;
grant execute on function get_event_recipients(uuid) to service_role;

-- _create_system_market: identical to 20260828100000's version except it no longer emits
-- market_opened itself. Emitting per-market here is exactly the thing being fixed -- a run that
-- creates several markets at once (weather regularly creates up to six) would fire that many
-- individual pushes. The calling Edge Function now calls _notify_system_markets_created() once,
-- after its own create loop finishes, so the decision between "one named push" and "one
-- consolidated push" can see the whole run's tally instead of one market at a time.
create or replace function _create_system_market(
  p_group_id uuid,
  p_title text,
  p_description text,
  p_market_type market_type,
  p_closes_at timestamptz,
  p_line numeric default null,
  p_unit text default null
) returns markets
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group groups%rowtype;
  v_title text;
  v_unit text;
  v_market markets%rowtype;
  v_pending_bonus int;
begin
  select * into v_group from groups where id = p_group_id;
  if v_group.id is null or not v_group.is_public then
    raise exception 'invalid_operation: system markets can only be created in a public group';
  end if;

  if v_group.deletion_scheduled_at is not null then
    raise exception 'invalid_operation: this group is scheduled for deletion and can''t start new markets';
  end if;

  if p_market_type not in ('yes_no', 'over_under') then
    raise exception 'invalid_operation: system markets support yes_no or over_under only';
  end if;

  v_title := nullif(trim(p_title), '');
  if v_title is null then
    raise exception 'invalid_operation: market title can''t be blank';
  end if;
  if length(v_title) > 140 then
    raise exception 'invalid_operation: market title must be 140 characters or fewer';
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

  insert into markets (group_id, season_id, title, description, market_type, line, creator_id, closes_at, unit, status, is_system_market)
  values (p_group_id, null, v_title, p_description, p_market_type, p_line, null, p_closes_at, v_unit, 'open', true)
  returning * into v_market;

  select pending_bonus_pool into v_pending_bonus from groups where id = p_group_id for update;
  if v_pending_bonus > 0 then
    update markets set bonus_pool = v_pending_bonus, carried_bonus_pool = v_pending_bonus where id = v_market.id
    returning * into v_market;
    update groups set pending_bonus_pool = 0 where id = p_group_id;
  end if;

  return v_market;
end;
$$;

revoke execute on function _create_system_market(uuid, text, text, market_type, timestamptz, numeric, text) from public;
revoke execute on function _create_system_market(uuid, text, text, market_type, timestamptz, numeric, text) from authenticated;
grant execute on function _create_system_market(uuid, text, text, market_type, timestamptz, numeric, text) to service_role;

-- Called once per pipeline create-run (not once per market), so the Edge Function decides "how
-- many markets did I just add" and this decides "how many pushes does that deserve": exactly one
-- named market_opened push when the run added a single market (unchanged from before this
-- migration), or one consolidated system_markets_opened push when it added two or more. A run
-- that added nothing calls this with an empty array and gets a no-op.
create or replace function _notify_system_markets_created(p_group_id uuid, p_market_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int := coalesce(array_length(p_market_ids, 1), 0);
begin
  if v_count = 1 then
    perform _emit_notification_event('market_opened', p_group_id, p_market_ids[1], null, null);
  elsif v_count >= 2 then
    perform _emit_notification_event('system_markets_opened', p_group_id, null, null, null);
  end if;
end;
$$;

revoke execute on function _notify_system_markets_created(uuid, uuid[]) from public;
revoke execute on function _notify_system_markets_created(uuid, uuid[]) from authenticated;
grant execute on function _notify_system_markets_created(uuid, uuid[]) to service_role;

-- create_market(): identical to 20260826100000's version except a new, unconditional gate right
-- after the is_public/name lookup -- Sports and Weather are pipeline-only boards, so hand-creating
-- a market there is rejected for a moderator or the owner exactly the same as a regular member,
-- not just gated down to moderators like an ordinary public group. Matched by name the same way
-- every pipeline Edge Function already looks its own group up (create_public_group() never
-- produces a group named exactly this, and neither group has a rename feature, so this is stable).
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
  v_group_name text;
begin
  perform 1 from memberships where group_id = p_group_id and user_id = v_user_id and status not in ('removed', 'left');
  if not found then
    raise exception 'not_found: not a member of this group';
  end if;

  select is_public, name into v_is_public, v_group_name from groups where id = p_group_id;

  if v_is_public and v_group_name in ('Sports', 'Weather') then
    raise exception 'invalid_operation: markets in this group are created automatically and can''t be started by hand';
  end if;

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

  return v_market;
end;
$$;

revoke execute on function create_market(uuid, text, text, market_type, timestamptz, numeric, uuid[], text[], text) from public;
grant execute on function create_market(uuid, text, text, market_type, timestamptz, numeric, uuid[], text[], text) to authenticated;

-- expire_stale(): identical to 20260828100000's version except the market_close loop now skips
-- market_closed specifically for a Weather system market -- see this migration's header comment
-- for why (Weather resolves within minutes of its own close, unlike Sports, so the push arrives
-- moments before the resolution push and says nothing useful in between).
create or replace function expire_stale()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  rec record;
  rec2 record;
  v_context text;
begin
  for rec in
    select id from markets
    where status = 'pending_sponsor'
      and (created_at < now() - interval '24 hours' or closes_at <= now())
    for update skip locked
  loop
    begin
      update markets set status = 'voided', outcome = 'void', resolved_at = now()
      where id = rec.id;
    exception when others then
      get stacked diagnostics v_context = pg_exception_context;
      perform _record_sweep_failure('sponsor_expiry', rec.id, sqlstate, sqlerrm, v_context);
    end;
  end loop;

  for rec in
    select m.id, m.group_id, m.is_system_market, g.name as group_name
    from markets m
    join groups g on g.id = m.group_id
    where m.status = 'open' and m.closes_at <= now()
    for update of m skip locked
  loop
    begin
      if rec.is_system_market or exists (select 1 from bets where market_id = rec.id) then
        update markets set status = 'closed', closed_at = now() where id = rec.id;
        if not (rec.is_system_market and rec.group_name = 'Weather') then
          perform _emit_notification_event('market_closed', rec.group_id, rec.id);
        end if;
      else
        perform _void_market(rec.id);
      end if;
    exception when others then
      get stacked diagnostics v_context = pg_exception_context;
      perform _record_sweep_failure('market_close', rec.id, sqlstate, sqlerrm, v_context);
    end;
  end loop;

  for rec in
    select m.id
    from markets m
    join resolution_proposals rp on rp.market_id = m.id
    join group_settings gs on gs.group_id = m.group_id
    where m.status = 'proposed' and rp.proposed_at + (gs.resolution_window_hours * interval '1 hour') <= now()
  loop
    begin
      perform finalize_market(rec.id);
    exception when others then
      get stacked diagnostics v_context = pg_exception_context;
      perform _record_sweep_failure('finalize_proposed', rec.id, sqlstate, sqlerrm, v_context);
    end;
  end loop;

  for rec in
    select m.id
    from markets m
    join challenges c on c.market_id = m.id
    join group_settings gs on gs.group_id = m.group_id
    where m.status = 'disputed' and c.created_at + (gs.resolution_window_hours * interval '1 hour') <= now()
  loop
    begin
      perform finalize_market(rec.id);
    exception when others then
      get stacked diagnostics v_context = pg_exception_context;
      perform _record_sweep_failure('finalize_disputed', rec.id, sqlstate, sqlerrm, v_context);
    end;
  end loop;

  -- Wind-down hard cap: force-void anything still proposed/disputed once a
  -- winding_down season's grace window has elapsed, then archive it. Most
  -- winding-down seasons never reach here at all - finalize_market()'s tail
  -- hook already archives the moment the last in-flight market clears
  -- naturally (via the two loops just above, or a direct owner/voter call).
  for rec in
    select m.id
    from seasons s
    join markets m on m.season_id = s.id
    where s.status = 'winding_down' and s.wind_down_deadline <= now()
      and m.status in ('proposed', 'disputed')
    for update of m skip locked
  loop
    begin
      perform _void_market(rec.id);
    exception when others then
      get stacked diagnostics v_context = pg_exception_context;
      perform _record_sweep_failure('wind_down_void', rec.id, sqlstate, sqlerrm, v_context);
    end;
  end loop;

  for rec in
    select id from seasons where status = 'winding_down' and wind_down_deadline <= now()
  loop
    begin
      perform _maybe_archive_winding_down_season(rec.id);
    exception when others then
      get stacked diagnostics v_context = pg_exception_context;
      perform _record_sweep_failure('wind_down_archive', rec.id, sqlstate, sqlerrm, v_context);
    end;
  end loop;

  -- Timed season auto-end. Calls the internal _end_season() rather than
  -- end_season(), which gates on auth.uid() and therefore always raised when
  -- called from cron - see 20260813170000. NULL actor is the correct
  -- attribution here: nobody ended this season, its date arrived.
  for rec in
    select group_id from seasons where status = 'active' and ends_at is not null and ends_at <= now()
  loop
    begin
      perform _end_season(rec.group_id, null::uuid);
    exception when others then
      get stacked diagnostics v_context = pg_exception_context;
      perform _record_sweep_failure('season_auto_end', rec.group_id, sqlstate, sqlerrm, v_context);
    end;
  end loop;

  -- Wrapped per group rather than per market: voiding the group's leftover
  -- markets, scheduling the deletion and emitting the notice are one decision
  -- about one group and must not be able to half-happen.
  for rec in
    select s.group_id
    from seasons s
    join groups g on g.id = s.group_id
    where s.status = 'intermission'
      and s.started_at <= now() - interval '30 days'
      and g.deletion_scheduled_at is null
  loop
    begin
      for rec2 in
        select id from markets
        where group_id = rec.group_id and status not in ('resolved', 'voided')
        for update
      loop
        -- Defensive: intermission means no active season, so nothing new
        -- could've been created since the group entered it - this should
        -- already be an empty set every time.
        perform _void_market(rec2.id);
      end loop;

      -- Pre-stamps both reminder columns so the two general-reminder loops below
      -- never pick this group up: this flow keeps its original single 5-day
      -- notice, not a second, differently-timed reminder on top of it.
      update groups
      set deletion_scheduled_at = now() + interval '5 days',
          deletion_reminder_7d_sent_at = now(),
          deletion_reminder_1d_sent_at = now()
      where id = rec.group_id;
      perform _emit_notification_event('group_deletion_scheduled_inactivity', rec.group_id, null, null, null);
    exception when others then
      get stacked diagnostics v_context = pg_exception_context;
      perform _record_sweep_failure('intermission_deletion', rec.group_id, sqlstate, sqlerrm, v_context);
    end;
  end loop;

  -- General inactivity sweep: unlike the intermission-specific one above (which
  -- only ever applies to a seasons-enabled group sitting between seasons), this
  -- covers every group regardless of whether seasons are even turned on.
  -- "Inactive" means no market created and no bet placed anywhere in the group for
  -- 90 days. A group with any market that isn't resolved/voided is left alone
  -- outright rather than force-voided here - a quiet-but-not-empty group can
  -- easily have one real market with real stakes still open (unlike the
  -- intermission sweep above, whose defensive void is only ever expected to find
  -- an empty set), and 90 days of no *new* activity is not the same claim as
  -- "nothing here matters."
  for rec in
    select g.id
    from groups g
    left join (
      select group_id, max(created_at) as last_created from markets group by group_id
    ) lm on lm.group_id = g.id
    left join (
      select m.group_id, max(b.created_at) as last_bet
      from bets b
      join markets m on m.id = b.market_id
      group by m.group_id
    ) lb on lb.group_id = g.id
    where g.deletion_scheduled_at is null
      and not exists (
        select 1 from markets m2 where m2.group_id = g.id and m2.status not in ('resolved', 'voided')
      )
      and greatest(g.created_at, coalesce(lm.last_created, g.created_at), coalesce(lb.last_bet, g.created_at))
        <= now() - interval '90 days'
  loop
    begin
      update groups set deletion_scheduled_at = now() + interval '14 days' where id = rec.id;
      perform _emit_notification_event('group_deletion_notice_14d', rec.id, null, null, null);
    exception when others then
      get stacked diagnostics v_context = pg_exception_context;
      perform _record_sweep_failure('general_inactivity_deletion', rec.id, sqlstate, sqlerrm, v_context);
    end;
  end loop;

  -- The two follow-up reminders. Gated purely on the stamp columns being unset
  -- rather than on which sweep did the scheduling - the intermission sweep above
  -- pre-stamps both the moment it schedules a deletion, so in practice these two
  -- loops only ever pick up a deletion scheduled by the 90-day sweep just above,
  -- whose 14-day grace is the only one long enough to still have 7 or 1 days left
  -- to warn about.
  for rec in
    select id from groups
    where deletion_scheduled_at is not null
      and deletion_reminder_7d_sent_at is null
      and deletion_scheduled_at - now() <= interval '7 days'
  loop
    begin
      update groups set deletion_reminder_7d_sent_at = now() where id = rec.id;
      perform _emit_notification_event('group_deletion_notice_7d', rec.id, null, null, null);
    exception when others then
      get stacked diagnostics v_context = pg_exception_context;
      perform _record_sweep_failure('deletion_reminder_7d', rec.id, sqlstate, sqlerrm, v_context);
    end;
  end loop;

  for rec in
    select id from groups
    where deletion_scheduled_at is not null
      and deletion_reminder_1d_sent_at is null
      and deletion_scheduled_at - now() <= interval '1 day'
  loop
    begin
      update groups set deletion_reminder_1d_sent_at = now() where id = rec.id;
      perform _emit_notification_event('group_deletion_notice_1d', rec.id, null, null, null);
    exception when others then
      get stacked diagnostics v_context = pg_exception_context;
      perform _record_sweep_failure('deletion_reminder_1d', rec.id, sqlstate, sqlerrm, v_context);
    end;
  end loop;

  for rec in
    select id from groups
    where deletion_scheduled_at is not null and deletion_scheduled_at <= now()
  loop
    begin
      delete from groups where id = rec.id;
    exception when others then
      get stacked diagnostics v_context = pg_exception_context;
      perform _record_sweep_failure('group_delete', rec.id, sqlstate, sqlerrm, v_context);
    end;
  end loop;
end;
$$;

revoke execute on function expire_stale() from public;
revoke execute on function expire_stale() from authenticated;
grant execute on function expire_stale() to service_role;
