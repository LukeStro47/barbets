-- assigned_group_moderator joins the group-scoped, no-market-required allow-list.
alter table notification_events drop constraint notification_events_market_events_have_market;
alter table notification_events add constraint notification_events_market_events_have_market check (
  (event_type in (
    'season_ended', 'betting_opened', 'member_joined',
    'group_deletion_scheduled', 'group_deletion_canceled', 'group_titles_updated',
    'season_betting_opened', 'group_deletion_scheduled_inactivity', 'admin_broadcast',
    'weekend_nudge', 'group_deletion_notice_14d', 'group_deletion_notice_7d', 'group_deletion_notice_1d',
    'assigned_group_moderator'
  ))
  or (market_id is not null)
);

-- Same category as member_joined/betting_opened — "something administrative happened in a group
-- you're in."
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

-- Single-recipient, same pattern impressive_bet already uses: actor_id means "the one person to
-- notify", not "exclude" — see get_event_recipients' existing comment on that repurposing. No
-- membership-active check here (unlike impressive_bet) since the recipient was only just inserted
-- as an active member in the same transaction that emits this.
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
    'group_deletion_notice_14d', 'group_deletion_notice_7d', 'group_deletion_notice_1d'
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
      and _prefs_allow(v_category, mem.notify_group, mem.notify_markets, mem.notify_results, mem.notify_admin, u.notify_nudges, u.notify_promos);
  end if;
end;
$$;

revoke execute on function get_event_recipients(uuid) from public;
revoke execute on function get_event_recipients(uuid) from authenticated;
grant execute on function get_event_recipients(uuid) to service_role;

-- create_public_group, rewritten. Two changes from 20260824160000's version:
--
-- 1. p_nickname is now optional. Creating a public group no longer forces the admin to become a
--    member — they're managing it via /admin as staff, not playing in it. Passing a nickname is
--    now the explicit "I'll moderate this one too" opt-in: it makes them a seeded, active member
--    with role = 'moderator' (on top of the owner authority they already have via groups.owner_id
--    either way).
-- 2. p_moderator_emails: for each address that matches an existing Barbets account, adds that user
--    directly as an active, seeded, role = 'moderator' member — no join step, no invite code — and
--    emits assigned_group_moderator so they get pushed. A nickname is auto-derived from the email's
--    local part (sanitized, deduped, blocklist-checked, falling back to a generic "mod" base) since
--    there's nobody at a join screen to type one in; they can rename via update_nickname() later.
--    An email with no matching account is skipped and returned in unresolved_emails so the caller
--    knows which ones didn't take.
drop function if exists create_public_group(text, text, int, text, text);

create function create_public_group(
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

  if not exists (select 1 from pg_timezone_names where name = p_timezone) then
    raise exception 'invalid_operation: unrecognized time zone';
  end if;

  insert into groups (name, owner_id, invite_code, is_public, category)
  values (v_name, v_user_id, _generate_invite_code(), true, p_category)
  returning * into v_group;

  -- Every hard-rule flag set explicitly here, not left to a column default: a public group must
  -- never momentarily exist without the rules that define it (see 20260825100000's coercion in
  -- update_group_settings, which corrects these if this insert is ever wrong again).
  insert into group_settings (
    group_id, seed_amount, seasons_enabled, timezone, betting_enabled, accepting_members,
    allow_hedged_bets, require_endorsement, awards_enabled
  )
  values (v_group.id, p_seed_amount, false, p_timezone, true, true, false, false, false);

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
    returning id into v_membership_id;

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

      -- Already handled above (the admin invited themselves), or already added by an earlier
      -- duplicate in the same list — either way, nothing new to do.
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
      returning id into v_membership_id;

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
