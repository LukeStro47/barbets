-- A subject gets 404'd out of a market entirely pre-resolution (is_market_visible), so they've
-- never had any signal that a market about them exists until it resolves. This adds one narrow,
-- deliberate exception: a push telling them a market just opened about them, with zero content
-- (no title, no description, no criteria, no who-else-is-involved) — just a link to a stripped
-- "pulse" view where they can watch bet count/volume/odds live, same numbers everyone else sees,
-- without anything that would identify what the market is actually about. Odds are shown even
-- while the market is still 'open' (get_closed_odds gates that for everyone else, to stop bettors
-- from being swayed by live odds while they can still act on them) — a subject can never place a
-- bet on a market they're the subject of (is_market_visible blocks place_bet the same as
-- everything else), so there's no manipulation concern unique to them seeing it early.

-- get_subject_market_pulse: the "header" facts (status/type/closes_at) plus the total bet
-- count/volume. Deliberately does NOT reuse is_market_visible (that function's whole purpose is
-- to say no to a subject pre-resolution) — this is the one place that's the point, gated by its
-- own explicit checks instead: real member of the group, an actual subject of THIS market, and
-- not yet resolved/voided (once resolved, is_market_visible already opens up the real page, so
-- this function's job is done and it declines rather than duplicating that path).
create or replace function get_subject_market_pulse(p_market_id uuid)
returns table (status market_status, market_type market_type, closes_at timestamptz, bet_count bigint, pool_amount bigint)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_market markets%rowtype;
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

  return query
  select v_market.status, v_market.market_type, v_market.closes_at,
         count(b.id) as bet_count, coalesce(sum(b.amount), 0)::bigint as pool_amount
  from bets b
  where b.market_id = p_market_id;
end;
$$;

revoke execute on function get_subject_market_pulse(uuid) from public;
grant execute on function get_subject_market_pulse(uuid) to authenticated;

-- get_subject_market_pulse_sides: same authorization as above, repeated rather than factored out
-- (cheap, and keeps each function independently safe to call). No multiple_choice equivalent —
-- option labels are exactly the kind of content this feature exists to hide, so there's no safe
-- per-option breakdown to offer; a multiple_choice subject gets bet_count/pool_amount only.
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

  if v_market.market_type = 'multiple_choice' then
    raise exception 'invalid_operation: no side breakdown for multiple choice markets';
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

-- create_market(): unchanged except the trailing notification block also emits
-- market_opened_about_you when the newly-opened market actually has subjects (never for a market
-- that lands in pending_sponsor — that event fires from sponsor_market() instead, once it's
-- actually open).
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
begin
  perform 1 from memberships where group_id = p_group_id and user_id = v_user_id and status <> 'removed';
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

  if p_closes_at <= now() then
    raise exception 'invalid_operation: closes_at must be in the future';
  end if;

  v_unit := nullif(trim(coalesce(p_unit, '')), '');
  if v_unit is not null then
    if p_market_type <> 'over_under' then
      raise exception 'invalid_operation: a unit only applies to over/under markets';
    end if;
    if length(v_unit) > 12 then
      raise exception 'invalid_operation: unit must be 12 characters or fewer';
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

  select count(*) into v_member_count from memberships where group_id = p_group_id and status <> 'removed';

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
    values (p_group_id, v_season_id, p_title, p_description, p_market_type, null, v_user_id, p_closes_at, null, v_initial_status)
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
    values (p_group_id, v_season_id, p_title, p_description, p_market_type, p_line, v_user_id, p_closes_at, v_unit, v_initial_status)
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

-- sponsor_market(): unchanged except the same market_opened_about_you addition, right alongside
-- the market_opened event it already emits once endorsement flips a market to 'open'.
create or replace function sponsor_market(p_market_id uuid)
returns markets
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_market markets%rowtype;
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

  if v_market.status <> 'pending_sponsor' then
    raise exception 'invalid_operation: market is already sponsored or has expired';
  end if;

  if v_market.closes_at < now() + interval '5 minutes' then
    raise exception 'invalid_operation: too little time is left before betting closes to endorse this market now';
  end if;

  if v_user_id = v_market.creator_id then
    raise exception 'invalid_operation: the creator cannot sponsor their own market';
  end if;

  update markets set sponsor_id = v_user_id, status = 'open'
  where id = p_market_id
  returning * into v_market;

  perform _emit_notification_event('market_opened', v_market.group_id, v_market.id, null, v_user_id);
  if exists (select 1 from market_subjects where market_id = v_market.id) then
    perform _emit_notification_event('market_opened_about_you', v_market.group_id, v_market.id, null, v_user_id);
  end if;

  return v_market;
end;
$$;

revoke execute on function sponsor_market(uuid) from public;
grant execute on function sponsor_market(uuid) to authenticated;

-- get_event_recipients: market_opened_about_you is the mirror image of every other market-scoped
-- branch below — those all exclude subjects (via get_notification_recipients' default), this one
-- is subjects ONLY, straight off market_subjects rather than get_notification_recipients at all.
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
  elsif v_event.event_type = 'clarification_requested' then
    return query
    select m.creator_id as user_id
    from markets m
    join push_subscriptions ps on ps.user_id = m.creator_id
    join users u on u.id = m.creator_id and u.notifications_enabled = true
    where m.id = v_event.market_id
      and (v_event.actor_id is null or m.creator_id <> v_event.actor_id)
    group by m.creator_id;
  elsif v_event.event_type = 'market_opened_about_you' then
    return query
    select ms.user_id
    from market_subjects ms
    join memberships m on m.group_id = v_event.group_id and m.user_id = ms.user_id and m.status = 'active'
    join push_subscriptions ps on ps.user_id = ms.user_id
    join users u on u.id = ms.user_id and u.notifications_enabled = true
    where ms.market_id = v_event.market_id
      and (v_event.actor_id is null or ms.user_id <> v_event.actor_id)
    group by ms.user_id;
  elsif v_event.event_type in (
    'season_ended', 'betting_opened', 'group_deletion_scheduled', 'group_deletion_canceled', 'group_titles_updated',
    'season_betting_opened', 'group_deletion_scheduled_inactivity'
  ) then
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
    from get_notification_recipients(v_event.market_id, v_event.event_type in ('market_resolved', 'market_voided')) gnr
    where v_event.actor_id is null or gnr.user_id <> v_event.actor_id;
  end if;
end;
$$;

revoke execute on function get_event_recipients(uuid) from public;
revoke execute on function get_event_recipients(uuid) from authenticated;
grant execute on function get_event_recipients(uuid) to service_role;
