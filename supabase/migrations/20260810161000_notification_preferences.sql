-- Per-category, per-group notification preferences, replacing the single
-- users.notifications_enabled kill switch as the only control anyone had.
--
-- Three categories, chosen because they're the three different *reasons* a push
-- arrives, not because they map neatly onto event types:
--
--   general  (per group, and split three ways inside it) — something happened
--            in a group you're in
--   nudges   (one global switch)  — nothing happened, and that's the point
--   promos   (one global switch)  — the app itself is talking to you
--
-- The general category lives on `memberships`, not in a new preferences table:
-- identity in this app is already per-group (memberships.nickname), a
-- membership row already exists for exactly the (user, group) pairs that can
-- receive a group notification, and get_event_recipients already joins that
-- table in every branch. A separate table would need its own RLS, its own
-- lifecycle on join/leave, and a left join with a default everywhere.
--
-- Nudges and promos are global rather than per-group on purpose: "stop pestering
-- me" and "no marketing" are feelings about the app, not about one friend group,
-- and making them per-group would mean re-answering them for every group joined.
alter table users add column notify_nudges boolean not null default true;
alter table users add column notify_promos boolean not null default true;

alter table memberships add column notify_group boolean not null default true;
alter table memberships add column notify_markets boolean not null default true;
alter table memberships add column notify_results boolean not null default true;
alter table memberships add column notify_admin boolean not null default true;

-- The event -> category map. Kept as one function rather than inlined into
-- get_event_recipients so that adding an event type has exactly one place to
-- forget, and forgetting is safe: an unmapped type falls through to 'other',
-- which _prefs_allow lets through. A new notification defaulting to "delivered"
-- is the right failure mode, since the alternative is silently dropping it.
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

    when 'weekend_nudge' then 'nudges'
    when 'market_closing_soon' then 'nudges'

    -- The only channel that exists purely to market at someone.
    when 'admin_broadcast' then 'promos'

    else 'other'
  end;
$$;

revoke execute on function _notification_category(notification_event_type) from public;
revoke execute on function _notification_category(notification_event_type) from authenticated;

-- Takes scalars rather than the membership/user rows themselves so it can be
-- dropped into a WHERE clause in each of get_event_recipients' branches without
-- every branch having to select whole composite rows.
create or replace function _prefs_allow(
  p_category text,
  p_notify_group boolean,
  p_notify_markets boolean,
  p_notify_results boolean,
  p_notify_admin boolean,
  p_notify_nudges boolean,
  p_notify_promos boolean
) returns boolean
language sql
immutable
set search_path = public
as $$
  select case p_category
    when 'markets' then p_notify_group and p_notify_markets
    when 'results' then p_notify_group and p_notify_results
    when 'admin' then p_notify_group and p_notify_admin
    -- A nudge is still about one specific group, so muting that group mutes its
    -- nudges too, even with the global nudge switch left on.
    when 'nudges' then p_notify_group and p_notify_nudges
    -- Promos deliberately ignore the per-group switch: they aren't really about
    -- the group they happen to be addressed through.
    when 'promos' then p_notify_promos
    else true
  end;
$$;

revoke execute on function _prefs_allow(text, boolean, boolean, boolean, boolean, boolean, boolean) from public;
revoke execute on function _prefs_allow(text, boolean, boolean, boolean, boolean, boolean, boolean) from authenticated;

-- get_event_recipients: same branch structure as before, with every branch now
-- also filtered through the recipient's own preferences, plus new branches for
-- the two nudge types (whose eligibility rules are the whole feature — see the
-- comments on each).
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
  elsif v_event.event_type = 'impressive_bet' then
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
    -- Group-scoped, active members only. Dormant members are sitting the season
    -- out by choice, so "go start a market" isn't addressed to them.
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
    -- The whole point of this one is *who* it reaches, so the eligibility rules
    -- live here rather than in the sweep that emits it: never a subject (the
    -- market doesn't exist as far as they're concerned), never someone who
    -- already has a bet on it (they've acted, there's nothing to nudge), and
    -- only someone who hasn't bet anywhere in this group for a week. Without
    -- that last condition this is just a "market closing" blast to the whole
    -- group, which is a different (and more annoying) feature.
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
    'season_betting_opened', 'group_deletion_scheduled_inactivity'
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
    -- Market-scoped events still go through get_notification_recipients (subject
    -- exclusion, active-only, has a subscription); the join back to memberships
    -- is purely to read the preferences it doesn't know about.
    return query
    select gnr.user_id
    from get_notification_recipients(v_event.market_id, v_event.event_type in ('market_resolved', 'market_voided')) gnr
    join memberships mem on mem.group_id = v_event.group_id and mem.user_id = gnr.user_id
    join users u on u.id = gnr.user_id
    where (v_event.actor_id is null or gnr.user_id <> v_event.actor_id)
      and _prefs_allow(v_category, mem.notify_group, mem.notify_markets, mem.notify_results, mem.notify_admin, u.notify_nudges, u.notify_promos);
  end if;
end;
$$;

revoke execute on function get_event_recipients(uuid) from public;
revoke execute on function get_event_recipients(uuid) from authenticated;
grant execute on function get_event_recipients(uuid) to service_role;

-- The master switch used to be written with a plain `update users` from a Server
-- Action. `users` has select and insert policies but deliberately no update
-- policy, so that write was silently affecting zero rows — RLS-filtered updates
-- don't error, they just match nothing. Routing it through a SECURITY DEFINER
-- function is both the fix and what this codebase's "all mutation goes through
-- SECURITY DEFINER functions" rule required in the first place.
create function set_notifications_enabled(p_enabled boolean)
returns users
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user users%rowtype;
begin
  if auth.uid() is null then
    raise exception 'not_found: unauthenticated';
  end if;

  update users set notifications_enabled = coalesce(p_enabled, true) where id = auth.uid() returning * into v_user;
  return v_user;
end;
$$;

revoke execute on function set_notifications_enabled(boolean) from public;
grant execute on function set_notifications_enabled(boolean) to authenticated;

create function update_notification_categories(p_notify_nudges boolean, p_notify_promos boolean)
returns users
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user users%rowtype;
begin
  if auth.uid() is null then
    raise exception 'not_found: unauthenticated';
  end if;

  update users
  set notify_nudges = coalesce(p_notify_nudges, true),
      notify_promos = coalesce(p_notify_promos, true)
  where id = auth.uid()
  returning * into v_user;

  return v_user;
end;
$$;

revoke execute on function update_notification_categories(boolean, boolean) from public;
grant execute on function update_notification_categories(boolean, boolean) to authenticated;

-- Always the caller's own membership: there's no p_user_id, so there's nothing
-- to authorize beyond "are you in this group at all," and the 404-not-403 rule
-- covers the case where you aren't.
create function update_group_notification_prefs(
  p_group_id uuid,
  p_notify_group boolean,
  p_notify_markets boolean,
  p_notify_results boolean,
  p_notify_admin boolean
) returns memberships
language plpgsql
security definer
set search_path = public
as $$
declare
  v_membership memberships%rowtype;
begin
  update memberships
  set notify_group = coalesce(p_notify_group, true),
      notify_markets = coalesce(p_notify_markets, true),
      notify_results = coalesce(p_notify_results, true),
      notify_admin = coalesce(p_notify_admin, true)
  where group_id = p_group_id and user_id = auth.uid() and status <> 'removed'
  returning * into v_membership;

  if v_membership.id is null then
    raise exception 'not_found: group not found';
  end if;

  return v_membership;
end;
$$;

revoke execute on function update_group_notification_prefs(uuid, boolean, boolean, boolean, boolean) from public;
grant execute on function update_group_notification_prefs(uuid, boolean, boolean, boolean, boolean) to authenticated;
