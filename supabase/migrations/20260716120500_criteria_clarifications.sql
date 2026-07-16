-- Lets a non-creator member flag that a market's resolution criteria
-- (markets.description) is unclear while betting is still open, and lets
-- the creator tighten the wording in response. Not secret: everyone who can
-- see the market sees the question/update trail, same posture as
-- resolution_proposals/challenges. Mutated only through the two
-- SECURITY DEFINER functions below — no client insert/update policy.
create table resolution_clarifications (
  id uuid primary key default gen_random_uuid(),
  market_id uuid not null references markets (id) on delete cascade,
  requester_id uuid not null references users (id),
  question text not null,
  created_at timestamptz not null default now(),
  -- null while pending; set when the creator's next update clears it. There
  -- is no separate "answer" column — the answer is the updated description.
  answered_at timestamptz
);

create index idx_resolution_clarifications_market on resolution_clarifications (market_id);

alter table resolution_clarifications enable row level security;

create policy resolution_clarifications_select on resolution_clarifications for select
  using (is_market_visible(market_id));

create or replace function request_clarification(p_market_id uuid, p_question text)
returns resolution_clarifications
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_market markets%rowtype;
  v_row resolution_clarifications%rowtype;
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

  if v_market.status <> 'open' then
    raise exception 'invalid_operation: can only ask for clarification while betting is open';
  end if;

  if v_user_id = v_market.creator_id then
    raise exception 'invalid_operation: you created this market, you can edit the criteria directly';
  end if;

  if p_question is null or length(trim(p_question)) = 0 then
    raise exception 'invalid_operation: question cannot be empty';
  end if;

  insert into resolution_clarifications (market_id, requester_id, question)
  values (p_market_id, v_user_id, trim(p_question))
  returning * into v_row;

  perform _emit_notification_event('clarification_requested', v_market.group_id, p_market_id, null, v_user_id);

  return v_row;
end;
$$;

revoke execute on function request_clarification(uuid, text) from public;
grant execute on function request_clarification(uuid, text) to authenticated;

create or replace function update_resolution_criteria(p_market_id uuid, p_description text)
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

  perform 1 from memberships where group_id = v_market.group_id and user_id = v_user_id and status <> 'removed';
  if not found then
    raise exception 'not_found: not a member of this group';
  end if;

  -- Plain authorization check, not subject-masking: the creator can never
  -- be a subject of their own market (enforced in create_market), so there
  -- is nothing to 404-mask here. Mirrors end_season's owner-only check.
  if v_user_id <> v_market.creator_id then
    raise exception 'forbidden: only the market creator can update the resolution criteria';
  end if;

  if v_market.status <> 'open' then
    raise exception 'invalid_operation: can only update resolution criteria while betting is open';
  end if;

  if not exists (select 1 from resolution_clarifications where market_id = p_market_id and answered_at is null) then
    raise exception 'invalid_operation: no pending clarification request to respond to';
  end if;

  if p_description is null or length(trim(p_description)) = 0 then
    raise exception 'invalid_operation: resolution criteria cannot be empty';
  end if;

  update markets set description = trim(p_description) where id = p_market_id
  returning * into v_market;

  update resolution_clarifications set answered_at = now()
  where market_id = p_market_id and answered_at is null;

  perform _emit_notification_event('criteria_updated', v_market.group_id, p_market_id, null, v_user_id);

  return v_market;
end;
$$;

revoke execute on function update_resolution_criteria(uuid, text) from public;
grant execute on function update_resolution_criteria(uuid, text) to authenticated;

-- get_event_recipients: clarification_requested is single-recipient like
-- member_joined/impressive_bet, just always the market's creator rather
-- than a group owner or a repurposed actor_id. criteria_updated needs no
-- new branch here — it already falls into the generic
-- get_notification_recipients() path below, which is exactly right
-- (every currently-visible non-subject member, actor excluded; subjects
-- stay excluded since the market still isn't resolved).
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
  elsif v_event.event_type in (
    'season_ended', 'betting_opened', 'group_deletion_scheduled', 'group_deletion_canceled', 'group_titles_updated'
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
