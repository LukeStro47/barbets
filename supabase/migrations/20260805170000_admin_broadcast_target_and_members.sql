-- Lets an admin target one specific member of a group instead of always
-- blasting everyone, and adds a members listing for the admin UI's picker.

alter table notification_events add column target_user_id uuid references users (id) on delete cascade;

-- Per the codebase's own documented overload gotcha: adding a trailing
-- parameter changes the function's identity, so the old signature is
-- dropped explicitly rather than left for CREATE OR REPLACE to orphan.
drop function if exists send_admin_broadcast(uuid, text, text);

create function send_admin_broadcast(p_group_id uuid, p_title text, p_body text, p_target_user_id uuid default null)
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

  if p_target_user_id is not null
     and not exists (select 1 from memberships where group_id = p_group_id and user_id = p_target_user_id and status <> 'removed')
  then
    raise exception 'invalid_operation: that person is not a member of this group';
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

  insert into notification_events (event_type, group_id, actor_id, custom_title, custom_body, target_user_id)
  values ('admin_broadcast', p_group_id, auth.uid(), v_title, v_body, p_target_user_id);
end;
$$;

revoke execute on function send_admin_broadcast(uuid, text, text, uuid) from public;
grant execute on function send_admin_broadcast(uuid, text, text, uuid) to authenticated;

-- admin_broadcast moves into its own branch (out of the shared group-scoped
-- list) so it can pick between "just this one person" and "everyone in the
-- group" — the only event type with a target_user_id, and the only one
-- where targeting a specific person should skip the usual actor exclusion:
-- an admin deliberately targeting themselves (e.g. to check their own
-- device) should actually receive it, unlike an accidental self-broadcast.
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
  elsif v_event.event_type = 'admin_broadcast' then
    return query
    select m.user_id
    from memberships m
    join push_subscriptions ps on ps.user_id = m.user_id
    join users u on u.id = m.user_id and u.notifications_enabled = true
    where m.group_id = v_event.group_id
      and m.status <> 'removed'
      and (
        (v_event.target_user_id is not null and m.user_id = v_event.target_user_id)
        or (v_event.target_user_id is null and (v_event.actor_id is null or m.user_id <> v_event.actor_id))
      )
    group by m.user_id;
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

-- Powers the admin broadcast form's per-group recipient picker.
create function list_group_members_for_admin()
returns table (group_id uuid, user_id uuid, nickname citext)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not is_platform_admin() then
    raise exception 'forbidden: admin only';
  end if;

  return query
  select m.group_id, m.user_id, m.nickname
  from memberships m
  where m.status <> 'removed'
  order by m.nickname;
end;
$$;

revoke execute on function list_group_members_for_admin() from public;
grant execute on function list_group_members_for_admin() to authenticated;
