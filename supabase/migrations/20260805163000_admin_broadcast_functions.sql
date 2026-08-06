-- admin_broadcast: lets an admin push a custom-content notification to every
-- (non-removed) member of one group, for testing marketing/ad creative with
-- real test users. Reuses the existing notification_events -> send-push
-- pipeline instead of a parallel delivery path, since VAPID/FCM secrets are
-- Edge-Function-only and never reachable from Next.js.

-- No market_id needed for this event type, same as every other group-scoped
-- event already in this list.
alter table notification_events drop constraint notification_events_market_events_have_market;
alter table notification_events add constraint notification_events_market_events_have_market check (
  (event_type in (
    'season_ended', 'betting_opened', 'member_joined',
    'group_deletion_scheduled', 'group_deletion_canceled', 'group_titles_updated',
    'season_betting_opened', 'group_deletion_scheduled_inactivity', 'admin_broadcast'
  ))
  or (market_id is not null)
);

-- Bypasses _emit_notification_event() (whose signature has no room for
-- custom text and is depended on by 8 other call sites) with a direct,
-- narrowly-scoped insert instead of widening a shared helper.
create function send_admin_broadcast(p_group_id uuid, p_title text, p_body text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_title text := trim(p_title);
  v_body text := trim(p_body);
begin
  if not is_platform_admin() then
    raise exception 'forbidden: admin only';
  end if;

  if not exists (select 1 from groups where id = p_group_id) then
    raise exception 'not_found: group not found';
  end if;

  if v_title = '' or v_title is null then
    raise exception 'invalid_operation: title can''t be blank';
  end if;
  if length(v_title) > 100 then
    raise exception 'invalid_operation: title is too long, keep it under 100 characters';
  end if;
  if v_body = '' or v_body is null then
    raise exception 'invalid_operation: body can''t be blank';
  end if;
  if length(v_body) > 300 then
    raise exception 'invalid_operation: body is too long, keep it under 300 characters';
  end if;

  insert into notification_events (event_type, group_id, actor_id, custom_title, custom_body)
  values ('admin_broadcast', p_group_id, auth.uid(), v_title, v_body);
end;
$$;

revoke execute on function send_admin_broadcast(uuid, text, text) from public;
grant execute on function send_admin_broadcast(uuid, text, text) to authenticated;

-- Adds 'admin_broadcast' to the group-scoped recipient branch — reuses the
-- exact "every non-removed member with a live subscription and notifications
-- on" rule every other group-wide event already uses, zero new logic.
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
    'season_betting_opened', 'group_deletion_scheduled_inactivity', 'admin_broadcast'
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
