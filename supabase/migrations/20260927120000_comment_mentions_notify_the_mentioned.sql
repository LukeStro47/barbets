-- @mentions in comments now notify the person mentioned, and only them.
--
-- 20260923120000 sent market_comment_mention to the market's whole visible
-- audience whenever a comment contained any @member, a documented shortcut
-- taken because routing a push to one specific member meant threading their
-- id through get_event_recipients(). notification_events.target_user_id
-- (added for admin_broadcast) already carries exactly that, so the shortcut
-- is no longer needed: each distinct member a comment names gets one event
-- addressed to them.
--
-- Who counts as mentioned: an @token matching a current (active or dormant)
-- member's nickname, case-insensitively, excluding the commenter. And only
-- if that member can see the market: someone a market is hidden from must
-- not be told a comment about it exists, so is_market_visible() decides,
-- same as every other read.

create function _emit_comment_mentions(p_market_id uuid, p_body text, p_actor_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group_id uuid;
begin
  select group_id into v_group_id from markets where id = p_market_id;

  insert into notification_events (event_type, group_id, market_id, actor_id, target_user_id)
  select distinct 'market_comment_mention'::notification_event_type, v_group_id, p_market_id, p_actor_id, m.user_id
  from regexp_matches(p_body, '@([A-Za-z0-9_]+)', 'g') as tok
  join memberships m on m.group_id = v_group_id and m.status in ('active', 'dormant')
  where lower(m.nickname::text) = lower(tok[1])
    and m.user_id <> p_actor_id
    and is_market_visible(p_market_id, m.user_id);
end;
$$;

revoke execute on function _emit_comment_mentions(uuid, text, uuid) from public;
revoke execute on function _emit_comment_mentions(uuid, text, uuid) from anon;
revoke execute on function _emit_comment_mentions(uuid, text, uuid) from authenticated;

create or replace function post_market_comment(p_market_id uuid, p_body text)
returns market_comments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_body text := trim(p_body);
  v_comment market_comments%rowtype;
begin
  if not is_market_visible(p_market_id, v_user_id) then
    raise exception 'not_found: market not found';
  end if;

  if v_body = '' or char_length(v_body) > 2000 then
    raise exception 'invalid_operation: a comment has to be between 1 and 2000 characters';
  end if;

  insert into market_comments (market_id, user_id, body)
  values (p_market_id, v_user_id, v_body)
  returning * into v_comment;

  perform _emit_comment_mentions(p_market_id, v_body, v_user_id);

  return v_comment;
end;
$$;

revoke execute on function post_market_comment(uuid, text) from public;
revoke execute on function post_market_comment(uuid, text) from anon;
grant execute on function post_market_comment(uuid, text) to authenticated;

create or replace function reveal_bet_in_comment(p_market_id uuid, p_body text)
returns market_comments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_body text := trim(p_body);
  v_bet bets%rowtype;
  v_comment market_comments%rowtype;
begin
  if not is_market_visible(p_market_id, v_user_id) then
    raise exception 'not_found: market not found';
  end if;

  select * into v_bet from bets where market_id = p_market_id and user_id = v_user_id limit 1;
  if v_bet.id is null then
    raise exception 'invalid_operation: you have no bet on this market to reveal';
  end if;

  if v_body = '' or char_length(v_body) > 2000 then
    raise exception 'invalid_operation: a comment has to be between 1 and 2000 characters';
  end if;

  insert into market_comments (market_id, user_id, body, revealed_side, revealed_option_id, revealed_amount)
  values (p_market_id, v_user_id, v_body, v_bet.side, v_bet.option_id, v_bet.amount)
  returning * into v_comment;

  perform _emit_comment_mentions(p_market_id, v_body, v_user_id);

  return v_comment;
end;
$$;

revoke execute on function reveal_bet_in_comment(uuid, text) from public;
revoke execute on function reveal_bet_in_comment(uuid, text) from anon;
grant execute on function reveal_bet_in_comment(uuid, text) to authenticated;

-- get_event_recipients: identical to 20260828130000's version plus one
-- branch, market_comment_mention -> its target_user_id alone (still gated on
-- a push subscription, notifications on, the member's preferences, and the
-- market being visible to them at send time).
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
  elsif v_event.event_type = 'market_comment_mention' then
    return query
    select u.id as user_id
    from users u
    join memberships mem on mem.group_id = v_event.group_id and mem.user_id = u.id and mem.status in ('active', 'dormant')
    join push_subscriptions ps on ps.user_id = u.id
    where u.id = v_event.target_user_id
      and u.notifications_enabled = true
      and (v_event.actor_id is null or u.id <> v_event.actor_id)
      and is_market_visible(v_event.market_id, u.id)
      and _prefs_allow(v_category, mem.notify_group, mem.notify_markets, mem.notify_results, mem.notify_admin, u.notify_nudges, u.notify_promos)
    group by u.id;
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
