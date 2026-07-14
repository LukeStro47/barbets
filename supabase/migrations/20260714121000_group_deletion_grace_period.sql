-- delete_group no longer deletes anything immediately. It now:
--   1. voids and refunds every non-terminal market in the group right away
--      (same _void_market() helper end_season() uses to force-void a
--      season's leftover open markets), so nobody's bet or vote is sitting
--      in limbo the instant deletion is requested;
--   2. schedules the actual row deletion 5 days out instead of running it
--      inline, so the group (and every market's final state) stays visible
--      and readable to every member for that window;
--   3. blocks new markets and new members for the group in the meantime
--      (create_market / join_group below), so nothing new gets created only
--      to be destroyed a few days later without anyone realizing why.
-- expire_stale() sweeps up the actual DELETE once the grace period elapses.
-- Nothing needs to change in place_bet/propose_resolution/cast_vote/etc for
-- this to be safe: those already reject a non-'open' (or non-matching)
-- market with a clean invalid_operation error, and step 1 above means every
-- market in a group pending deletion is already 'voided' the instant
-- deletion is requested — so a bet or vote already in flight when deletion
-- fires just hits that same existing, friendly rejection rather than
-- crashing or silently vanishing.

alter table notification_events drop constraint notification_events_market_events_have_market;
alter table notification_events add constraint notification_events_market_events_have_market check (
  (event_type in ('season_ended', 'betting_opened', 'member_joined', 'group_deletion_scheduled', 'group_deletion_canceled'))
  or (market_id is not null)
);

-- Return type changes from void to groups (so the caller can show "deletes
-- in N days"), which CREATE OR REPLACE can't do in place — Postgres requires
-- the old signature dropped first.
drop function if exists delete_group(uuid);

create function delete_group(p_group_id uuid)
returns groups
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_group groups%rowtype;
  rec record;
begin
  select * into v_group from groups where id = p_group_id for update;
  if v_group.id is null then
    raise exception 'not_found: group not found';
  end if;

  perform 1 from memberships where group_id = p_group_id and user_id = v_caller and status <> 'removed';
  if not found then
    raise exception 'not_found: group not found';
  end if;

  if v_caller <> v_group.owner_id then
    raise exception 'forbidden: only the group owner can delete the group';
  end if;

  if v_group.deletion_scheduled_at is not null then
    raise exception 'invalid_operation: this group is already scheduled for deletion';
  end if;

  for rec in
    select id from markets
    where group_id = p_group_id and status not in ('resolved', 'voided')
    for update
  loop
    perform _void_market(rec.id);
  end loop;

  update groups set deletion_scheduled_at = now() + interval '5 days'
  where id = p_group_id
  returning * into v_group;

  perform _emit_notification_event('group_deletion_scheduled', p_group_id, null, null, v_caller);

  return v_group;
end;
$$;

revoke execute on function delete_group(uuid) from public;
grant execute on function delete_group(uuid) to authenticated;

-- cancel_group_deletion: the undo, while the 5-day window is still open.
-- Doesn't (and can't) un-void the markets delete_group already refunded —
-- same as every other force-void in this app, that part is final — it just
-- stops the impending row deletion.
create function cancel_group_deletion(p_group_id uuid)
returns groups
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_group groups%rowtype;
begin
  select * into v_group from groups where id = p_group_id for update;
  if v_group.id is null then
    raise exception 'not_found: group not found';
  end if;

  perform 1 from memberships where group_id = p_group_id and user_id = v_caller and status <> 'removed';
  if not found then
    raise exception 'not_found: group not found';
  end if;

  if v_caller <> v_group.owner_id then
    raise exception 'forbidden: only the group owner can cancel deletion';
  end if;

  if v_group.deletion_scheduled_at is null then
    raise exception 'invalid_operation: this group isn''t scheduled for deletion';
  end if;

  update groups set deletion_scheduled_at = null where id = p_group_id returning * into v_group;

  perform _emit_notification_event('group_deletion_canceled', p_group_id, null, null, v_caller);

  return v_group;
end;
$$;

revoke execute on function cancel_group_deletion(uuid) from public;
grant execute on function cancel_group_deletion(uuid) to authenticated;

-- expire_stale: adds the actual hard-delete sweep for groups whose grace
-- period has elapsed. A plain DELETE is enough (same cascade chain
-- delete_group relied on before this migration) — every group-scoped table
-- cascades from groups.id, including notification_events itself.
create or replace function expire_stale()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  rec record;
begin
  for rec in
    select id from markets
    where status = 'pending_sponsor' and created_at < now() - interval '72 hours'
    for update
  loop
    update markets set status = 'voided', outcome = 'void', resolved_at = now()
    where id = rec.id;
  end loop;

  for rec in
    update markets
    set status = 'closed', closed_at = now()
    where status = 'open' and closes_at <= now()
    returning id, group_id
  loop
    perform _emit_notification_event('market_closed', rec.group_id, rec.id);
  end loop;

  for rec in
    select m.id
    from markets m
    join resolution_proposals rp on rp.market_id = m.id
    where m.status = 'proposed' and rp.proposed_at + interval '8 hours' <= now()
  loop
    perform finalize_market(rec.id);
  end loop;

  for rec in
    select m.id
    from markets m
    join challenges c on c.market_id = m.id
    where m.status = 'disputed' and c.created_at + interval '8 hours' <= now()
  loop
    perform finalize_market(rec.id);
  end loop;

  for rec in
    select s.group_id
    from seasons s
    join group_settings gs on gs.group_id = s.group_id
    where s.status = 'active'
      and gs.season_length <> 'manual'
      and s.started_at + (
        case gs.season_length
          when '1m' then interval '1 month'
          when '2m' then interval '2 months'
          when '3m' then interval '3 months'
        end
      ) <= now()
  loop
    perform end_season(rec.group_id);
  end loop;

  for rec in
    select id from groups
    where deletion_scheduled_at is not null and deletion_scheduled_at <= now()
  loop
    delete from groups where id = rec.id;
  end loop;

  delete from notification_events
  where processed_at is not null and processed_at < now() - interval '30 days';
end;
$$;

revoke execute on function expire_stale() from public;
revoke execute on function expire_stale() from authenticated;
grant execute on function expire_stale() to service_role;

-- get_event_recipients: group_deletion_scheduled/canceled reach the whole
-- roster, not just the owner (everyone's markets in that group just got
-- voided, and everyone needs to know the group is about to disappear) — same
-- recipient shape as season_ended/betting_opened, so they join that branch.
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
  elsif v_event.event_type in ('season_ended', 'betting_opened', 'group_deletion_scheduled', 'group_deletion_canceled') then
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

-- create_market: refuse to start new markets in a group that's scheduled
-- for deletion. Signature is unchanged, so a plain CREATE OR REPLACE is safe.
create or replace function create_market(
  p_group_id uuid,
  p_title text,
  p_description text,
  p_market_type market_type,
  p_closes_at timestamptz,
  p_line numeric default null,
  p_subject_user_ids uuid[] default '{}',
  p_options text[] default null
) returns markets
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_settings group_settings%rowtype;
  v_season_id uuid;
  v_member_count int;
  v_subject_ids uuid[];
  v_invalid_subject_count int;
  v_market markets%rowtype;
  v_option_count int;
  v_option_id uuid;
  v_option_text text;
  v_resolved_user_id uuid;
  v_all_subject_ids uuid[];
  v_idx int;
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
  if not v_settings.betting_enabled then
    raise exception 'invalid_operation: the group owner hasn''t turned betting on yet';
  end if;

  if p_closes_at <= now() then
    raise exception 'invalid_operation: closes_at must be in the future';
  end if;

  if v_settings.seasons_enabled then
    select id into v_season_id from seasons where group_id = p_group_id and status = 'active';
    if v_season_id is null then
      raise exception 'invalid_operation: the group is between seasons, wait for the new season to start';
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

    if array_length(v_all_subject_ids, 1) > 0 then
      if array_length(v_all_subject_ids, 1) <> (select count(distinct x) from unnest(v_all_subject_ids) as x) then
        raise exception 'invalid_operation: a member can only be a subject of one option';
      end if;

      if v_user_id = any(v_all_subject_ids) then
        raise exception 'invalid_operation: the creator cannot be a subject of their own market';
      end if;

      if array_length(v_all_subject_ids, 1) >= v_member_count - 1 then
        raise exception 'invalid_operation: this group has % members, so a market can have at most % subject(s). enough people need to be left to create, endorse, and bet on it', v_member_count, greatest(v_member_count - 2, 0);
      end if;
    end if;

    insert into markets (group_id, season_id, title, description, market_type, line, creator_id, closes_at)
    values (p_group_id, v_season_id, p_title, p_description, p_market_type, null, v_user_id, p_closes_at)
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
  else
    select array_agg(distinct x) into v_subject_ids from unnest(p_subject_user_ids) as x;

    if v_subject_ids is not null and v_user_id = any(v_subject_ids) then
      raise exception 'invalid_operation: the creator cannot be a subject of their own market';
    end if;

    if v_subject_ids is not null then
      if array_length(v_subject_ids, 1) >= v_member_count - 1 then
        raise exception 'invalid_operation: this group has % members, so a market can have at most % subject(s). enough people need to be left to create, endorse, and bet on it', v_member_count, greatest(v_member_count - 2, 0);
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

    insert into markets (group_id, season_id, title, description, market_type, line, creator_id, closes_at)
    values (p_group_id, v_season_id, p_title, p_description, p_market_type, p_line, v_user_id, p_closes_at)
    returning * into v_market;

    if v_subject_ids is not null then
      insert into market_subjects (market_id, user_id)
      select v_market.id, x from unnest(v_subject_ids) as x;
    end if;
  end if;

  perform _emit_notification_event('market_needs_endorsement', p_group_id, v_market.id, null, v_user_id);

  return v_market;
end;
$$;

revoke execute on function create_market(uuid, text, text, market_type, timestamptz, numeric, uuid[], text[]) from public;
grant execute on function create_market(uuid, text, text, market_type, timestamptz, numeric, uuid[], text[]) to authenticated;

-- join_group: refuse genuinely new memberships while deletion is scheduled.
-- A dormant member reactivating, or an already-active no-op, is left alone
-- (same "not actually new" carve-out accepting_members already uses) since
-- that doesn't create any new exposure beyond what's already there.
-- Signature is unchanged, so a plain CREATE OR REPLACE is safe.
create or replace function join_group(p_invite_code text, p_nickname citext default null)
returns memberships
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_group groups%rowtype;
  v_settings group_settings%rowtype;
  v_active_season seasons%rowtype;
  v_intermission_season seasons%rowtype;
  v_membership memberships%rowtype;
  v_seed int;
begin
  select * into v_group from groups where invite_code = p_invite_code::citext;
  if v_group.id is null then
    raise exception 'not_found: invalid invite code';
  end if;

  select * into v_membership from memberships where group_id = v_group.id and user_id = v_user_id;
  if v_membership.id is not null then
    if v_membership.status = 'removed' then
      raise exception 'forbidden: you can''t rejoin this group';
    end if;
    if v_membership.status = 'dormant' then
      update memberships set status = 'active' where id = v_membership.id returning * into v_membership;
    end if;
    return v_membership;
  end if;

  -- Only a genuinely new membership reaches here.
  if v_group.deletion_scheduled_at is not null then
    raise exception 'invalid_operation: this group is scheduled for deletion and isn''t taking new members';
  end if;

  select * into v_settings from group_settings where group_id = v_group.id;
  if not v_settings.accepting_members then
    raise exception 'invalid_operation: this group isn''t accepting new members right now';
  end if;

  if p_nickname is null or trim(p_nickname::text) = '' then
    raise exception 'invalid_operation: choose a nickname to join with';
  end if;
  if p_nickname::text !~ '^[A-Za-z0-9_]{1,20}$' then
    raise exception 'invalid_operation: nicknames can only use letters, numbers, and underscores, up to 20 characters';
  end if;
  perform 1 from memberships where group_id = v_group.id and nickname = p_nickname and status <> 'removed';
  if found then
    raise exception 'invalid_operation: that nickname is already taken in this group';
  end if;

  if v_settings.seasons_enabled then
    select * into v_active_season from seasons where group_id = v_group.id and status = 'active';
  end if;

  if v_settings.seasons_enabled and v_active_season.id is null then
    select * into v_intermission_season from seasons where group_id = v_group.id and status = 'intermission';

    insert into memberships (group_id, user_id, balance, status, nickname)
    values (v_group.id, v_user_id, 0, 'dormant', p_nickname)
    returning * into v_membership;

    if v_intermission_season.id is not null then
      insert into season_optins (season_id, user_id)
      values (v_intermission_season.id, v_user_id)
      on conflict do nothing;
    end if;

    perform _emit_notification_event('member_joined', v_group.id, null, null, v_user_id);

    return v_membership;
  end if;

  v_seed := case when v_settings.seasons_enabled then v_active_season.seed_amount else v_settings.seed_amount end;

  insert into memberships (group_id, user_id, balance, status, nickname)
  values (v_group.id, v_user_id, v_seed, 'active', p_nickname)
  returning * into v_membership;

  insert into ledger (membership_id, amount, reason)
  values (v_membership.id, v_seed, 'seed');

  perform _emit_notification_event('member_joined', v_group.id, null, null, v_user_id);

  return v_membership;
end;
$$;

revoke execute on function join_group(text, citext) from public;
grant execute on function join_group(text, citext) to authenticated;
