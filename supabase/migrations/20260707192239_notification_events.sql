-- Phase 6 (push notifications) infrastructure. Some transitions only ever
-- happen via expire_stale() (cron) — market auto-close, auto-finalize,
-- auto-end-season — so hooking notifications into the Next.js server
-- actions would silently miss most of them. Instead, every Postgres
-- function that causes a notifiable transition writes a row here, as part
-- of its own transaction, regardless of whether a human or cron triggered
-- it. A scheduled Edge Function (outside this migration) drains the queue,
-- computes recipients, and sends the actual pushes — decoupling "this
-- happened, exactly once" (transactionally safe) from "send a push"
-- (network I/O, retryable).

create type notification_event_type as enum (
  'market_needs_endorsement',
  'market_opened',
  'market_closed',
  'resolution_proposed',
  'resolution_challenged',
  'market_resolved',
  'season_ended'
);

create table notification_events (
  id uuid primary key default gen_random_uuid(),
  event_type notification_event_type not null,
  group_id uuid not null references groups (id) on delete cascade,
  market_id uuid references markets (id) on delete cascade,
  season_id uuid references seasons (id) on delete cascade,
  -- the user who triggered it, if any — excluded from recipients, since
  -- they already know (they just did it). Null for cron-triggered events.
  actor_id uuid references users (id),
  created_at timestamptz not null default now(),
  processed_at timestamptz,

  constraint notification_events_season_ended_has_season check (
    (event_type = 'season_ended') = (season_id is not null)
  ),
  constraint notification_events_market_events_have_market check (
    (event_type = 'season_ended') or (market_id is not null)
  )
);

create index idx_notification_events_unprocessed on notification_events (created_at) where processed_at is null;

alter table notification_events enable row level security;
-- No policies at all: this is a purely internal queue. Deny-by-default
-- blocks every client role; only service_role (which bypasses RLS
-- entirely) reads and updates it, from the send-push Edge Function.

-- _emit_notification_event: thin insert wrapper so every call site reads
-- the same either way, and so the constraints above only need satisfying
-- once here rather than at every call site.
create or replace function _emit_notification_event(
  p_event_type notification_event_type,
  p_group_id uuid,
  p_market_id uuid default null,
  p_season_id uuid default null,
  p_actor_id uuid default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into notification_events (event_type, group_id, market_id, season_id, actor_id)
  values (p_event_type, p_group_id, p_market_id, p_season_id, p_actor_id);
end;
$$;

revoke execute on function _emit_notification_event(notification_event_type, uuid, uuid, uuid, uuid) from public;
revoke execute on function _emit_notification_event(notification_event_type, uuid, uuid, uuid, uuid) from authenticated;

-- get_event_recipients: the single choke point the Edge Function calls per
-- queued event. Market-scoped events reuse get_notification_recipients()
-- (already correct and tested — subject exclusion, active-only, has a
-- subscription, notifications enabled) and just layer actor-exclusion on
-- top. season_ended is its own case: it must reach dormant members too
-- (they need to know the season ended in order to decide whether to opt
-- back in), which get_notification_recipients deliberately does not do for
-- market events.
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

  if v_event.event_type = 'season_ended' then
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
    from get_notification_recipients(v_event.market_id, v_event.event_type = 'market_resolved') gnr
    where v_event.actor_id is null or gnr.user_id <> v_event.actor_id;
  end if;
end;
$$;

revoke execute on function get_event_recipients(uuid) from public;
revoke execute on function get_event_recipients(uuid) from authenticated;
grant execute on function get_event_recipients(uuid) to service_role;

-- Below: the same 7 functions from earlier migrations, unchanged except for
-- one _emit_notification_event() call added at each notifiable transition.

create or replace function create_market(
  p_group_id uuid,
  p_title text,
  p_description text,
  p_market_type market_type,
  p_closes_at timestamptz,
  p_line numeric default null,
  p_subject_user_ids uuid[] default '{}'
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
begin
  perform 1 from memberships where group_id = p_group_id and user_id = v_user_id and status <> 'removed';
  if not found then
    raise exception 'not_found: not a member of this group';
  end if;

  if p_closes_at <= now() then
    raise exception 'invalid_operation: closes_at must be in the future';
  end if;

  select * into v_settings from group_settings where group_id = p_group_id;
  if v_settings.seasons_enabled then
    select id into v_season_id from seasons where group_id = p_group_id and status = 'active';
    if v_season_id is null then
      raise exception 'invalid_operation: the group is between seasons — wait for the new season to start';
    end if;
  end if;

  select array_agg(distinct x) into v_subject_ids from unnest(p_subject_user_ids) as x;

  if v_subject_ids is not null and v_user_id = any(v_subject_ids) then
    raise exception 'invalid_operation: the creator cannot be a subject of their own market';
  end if;

  if v_subject_ids is not null then
    select count(*) into v_member_count from memberships where group_id = p_group_id and status <> 'removed';

    if array_length(v_subject_ids, 1) >= v_member_count - 2 then
      raise exception 'invalid_operation: this group has % members, so a market can have at most % subject(s) — enough people need to be left to create, endorse, and bet on it', v_member_count, greatest(v_member_count - 3, 0);
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

  perform _emit_notification_event('market_needs_endorsement', p_group_id, v_market.id, null, v_user_id);

  return v_market;
end;
$$;

revoke execute on function create_market(uuid, text, text, market_type, timestamptz, numeric, uuid[]) from public;
grant execute on function create_market(uuid, text, text, market_type, timestamptz, numeric, uuid[]) to authenticated;

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

  if v_user_id = v_market.creator_id then
    raise exception 'invalid_operation: the creator cannot sponsor their own market';
  end if;

  update markets set sponsor_id = v_user_id, status = 'open'
  where id = p_market_id
  returning * into v_market;

  perform _emit_notification_event('market_opened', v_market.group_id, v_market.id, null, v_user_id);

  return v_market;
end;
$$;

revoke execute on function sponsor_market(uuid) from public;
grant execute on function sponsor_market(uuid) to authenticated;

create or replace function propose_resolution(
  p_market_id uuid,
  p_outcome market_outcome,
  p_justification text default null,
  p_actual_value numeric default null
) returns resolution_proposals
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_market markets%rowtype;
  v_proposal resolution_proposals%rowtype;
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

  if v_market.status <> 'closed' then
    raise exception 'invalid_operation: market is not awaiting a resolution proposal';
  end if;

  if (v_market.market_type = 'yes_no' and p_outcome not in ('yes', 'no', 'void'))
     or (v_market.market_type = 'over_under' and p_outcome not in ('over', 'under', 'void')) then
    raise exception 'invalid_operation: outcome does not match market type';
  end if;

  if p_actual_value is not null and v_market.market_type <> 'over_under' then
    raise exception 'invalid_operation: actual_value only applies to over/under markets';
  end if;

  insert into resolution_proposals (market_id, proposer_id, proposed_outcome, justification, actual_value)
  values (p_market_id, v_user_id, p_outcome, p_justification, p_actual_value)
  returning * into v_proposal;

  update markets set status = 'proposed' where id = p_market_id;

  perform _emit_notification_event('resolution_proposed', v_market.group_id, p_market_id, null, v_user_id);

  return v_proposal;
end;
$$;

revoke execute on function propose_resolution(uuid, market_outcome, text, numeric) from public;
grant execute on function propose_resolution(uuid, market_outcome, text, numeric) to authenticated;

create or replace function challenge_resolution(p_market_id uuid, p_reason text default null)
returns challenges
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_market markets%rowtype;
  v_proposal resolution_proposals%rowtype;
  v_challenge challenges%rowtype;
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

  if v_market.status <> 'proposed' then
    raise exception 'invalid_operation: market has no pending proposal to challenge';
  end if;

  select * into v_proposal from resolution_proposals where market_id = p_market_id;
  if v_proposal.proposed_at + interval '24 hours' <= now() then
    raise exception 'invalid_operation: the challenge window has closed';
  end if;

  if v_user_id = v_proposal.proposer_id then
    raise exception 'invalid_operation: you cannot challenge your own proposal';
  end if;

  insert into challenges (market_id, challenger_id, created_at)
  values (p_market_id, v_user_id, now())
  returning * into v_challenge;

  update markets set status = 'disputed' where id = p_market_id;

  if p_reason is not null then
    update resolution_proposals set justification = coalesce(justification, '') || E'\n\nChallenge: ' || p_reason
    where market_id = p_market_id;
  end if;

  perform _emit_notification_event('resolution_challenged', v_market.group_id, p_market_id, null, v_user_id);

  return v_challenge;
end;
$$;

revoke execute on function challenge_resolution(uuid, text) from public;
grant execute on function challenge_resolution(uuid, text) to authenticated;

create or replace function finalize_market(p_market_id uuid)
returns markets
language plpgsql
security definer
set search_path = public
as $$
declare
  v_market markets%rowtype;
  v_proposal resolution_proposals%rowtype;
  v_challenge challenges%rowtype;
  v_outcome market_outcome;
  v_actual_value numeric;
  v_top_count int;
  v_tie_count int;
  v_eligible_voters int;
  v_votes_cast int;
  v_total_pool bigint;
  v_winning_pool bigint;
  rec record;
begin
  select * into v_market from markets where id = p_market_id for update;
  if v_market.id is null then
    raise exception 'not_found: market not found';
  end if;

  if v_market.status not in ('proposed', 'disputed') then
    raise exception 'invalid_operation: market is not awaiting finalization';
  end if;

  select * into v_proposal from resolution_proposals where market_id = p_market_id;
  if v_proposal.id is null then
    raise exception 'invalid_operation: no proposal exists for this market';
  end if;

  if v_market.status = 'proposed' then
    if v_proposal.proposed_at + interval '24 hours' > now() then
      raise exception 'invalid_operation: the challenge window is still open';
    end if;
    v_outcome := v_proposal.proposed_outcome;
    v_actual_value := v_proposal.actual_value;
  else
    select * into v_challenge from challenges where market_id = p_market_id;

    select count(*) into v_eligible_voters
    from memberships m
    where m.group_id = v_market.group_id
      and m.status <> 'removed'
      and not exists (select 1 from market_subjects ms where ms.market_id = p_market_id and ms.user_id = m.user_id);
    select count(distinct voter_id) into v_votes_cast from votes where market_id = p_market_id;

    if v_challenge.created_at + interval '48 hours' > now() and v_votes_cast < v_eligible_voters then
      raise exception 'invalid_operation: the vote window is still open';
    end if;

    select v.outcome, count(*) into v_outcome, v_top_count
    from votes v
    where v.market_id = p_market_id
    group by v.outcome
    order by count(*) desc
    limit 1;

    if v_top_count is null or v_top_count = 0 then
      v_outcome := 'void';
    else
      select count(*) into v_tie_count
      from (
        select v.outcome
        from votes v
        where v.market_id = p_market_id
        group by v.outcome
        having count(*) = v_top_count
      ) ties;

      if v_tie_count > 1 then
        v_outcome := 'void';
      end if;
    end if;

    v_actual_value := v_proposal.actual_value;

    update resolution_proposals set votes_revealed_at = now() where market_id = p_market_id;
  end if;

  update resolution_proposals set finalized = true where market_id = p_market_id;

  if v_outcome = 'void' then
    perform refund_all_bets(p_market_id);
    update markets
    set status = 'voided', outcome = 'void', actual_value = v_actual_value, resolved_at = now()
    where id = p_market_id
    returning * into v_market;
    perform _emit_notification_event('market_resolved', v_market.group_id, v_market.id);
    return v_market;
  end if;

  select coalesce(sum(amount), 0) into v_total_pool
  from bets where market_id = p_market_id and settled_at is null;

  select coalesce(sum(amount), 0) into v_winning_pool
  from bets where market_id = p_market_id and settled_at is null and side = v_outcome::text::bet_side;

  if v_winning_pool = 0 then
    perform refund_all_bets(p_market_id);
    update markets
    set status = 'resolved', outcome = v_outcome, actual_value = v_actual_value, resolved_at = now()
    where id = p_market_id
    returning * into v_market;
    perform _emit_notification_event('market_resolved', v_market.group_id, v_market.id);
    return v_market;
  end if;

  for rec in
    with winners as (
      select b.id, b.user_id, b.amount, b.created_at,
             floor(b.amount::numeric * v_total_pool / v_winning_pool)::bigint as base_payout
      from bets b
      where b.market_id = p_market_id and b.settled_at is null and b.side = v_outcome::text::bet_side
    ),
    dust as (
      select v_total_pool - coalesce(sum(base_payout), 0) as amount from winners
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
  set status = 'resolved', outcome = v_outcome, actual_value = v_actual_value, resolved_at = now()
  where id = p_market_id
  returning * into v_market;

  perform _emit_notification_event('market_resolved', v_market.group_id, v_market.id);

  return v_market;
end;
$$;

revoke execute on function finalize_market(uuid) from public;
grant execute on function finalize_market(uuid) to authenticated;

create or replace function end_season(p_group_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_group groups%rowtype;
  v_season seasons%rowtype;
  v_next_number int;
  v_snapshot jsonb;
  rec record;
begin
  select * into v_group from groups where id = p_group_id;
  if v_group.id is null then
    raise exception 'not_found: group not found';
  end if;

  perform 1 from memberships where group_id = p_group_id and user_id = v_caller and status <> 'removed';
  if not found then
    raise exception 'not_found: group not found';
  end if;

  if v_caller <> v_group.owner_id then
    raise exception 'forbidden: only the group owner can end the season';
  end if;

  select * into v_season from seasons where group_id = p_group_id and status = 'active' for update;
  if v_season.id is null then
    raise exception 'invalid_operation: no active season to end';
  end if;

  for rec in
    select id from markets
    where season_id = v_season.id and status not in ('resolved', 'voided')
    for update
  loop
    perform _void_market(rec.id);
  end loop;

  select jsonb_build_object(
    'champion', (
      select jsonb_build_object('user_id', m.user_id, 'username', u.username, 'balance', m.balance)
      from memberships m join users u on u.id = m.user_id
      where m.group_id = p_group_id and m.status <> 'removed'
      order by m.balance desc, m.user_id
      limit 1
    ),
    'final_balances', (
      select coalesce(
        jsonb_agg(jsonb_build_object('user_id', m.user_id, 'username', u.username, 'balance', m.balance) order by m.balance desc),
        '[]'::jsonb
      )
      from memberships m join users u on u.id = m.user_id
      where m.group_id = p_group_id and m.status <> 'removed'
    ),
    'biggest_single_win', (
      select jsonb_build_object('user_id', u.id, 'username', u.username, 'amount', l.amount, 'market_id', l.market_id)
      from ledger l
      join memberships m on m.id = l.membership_id
      join users u on u.id = m.user_id
      where m.group_id = p_group_id and l.reason = 'payout' and l.created_at >= v_season.started_at
      order by l.amount desc
      limit 1
    ),
    'worst_beat', (
      select jsonb_build_object('user_id', u.id, 'username', u.username, 'amount', b.amount, 'market_id', b.market_id)
      from bets b
      join markets mk on mk.id = b.market_id
      join users u on u.id = b.user_id
      where mk.group_id = p_group_id and mk.season_id = v_season.id and b.payout = 0
      order by b.amount desc
      limit 1
    )
  ) into v_snapshot;

  insert into season_results (group_id, season_id, snapshot)
  values (p_group_id, v_season.id, v_snapshot);

  update seasons set status = 'archived', ended_at = now() where id = v_season.id;

  perform _emit_notification_event('season_ended', p_group_id, null, v_season.id, v_caller);

  select coalesce(max(number), 0) + 1 into v_next_number from seasons where group_id = p_group_id;

  insert into seasons (group_id, number, status)
  values (p_group_id, v_next_number, 'intermission');
end;
$$;

revoke execute on function end_season(uuid) from public;
grant execute on function end_season(uuid) to authenticated;

-- expire_stale: only the open->closed step changes (was a bare bulk
-- UPDATE with no per-row hook to emit from — now loops and emits one
-- 'market_closed' event per market that actually transitions). The other
-- four steps already route through finalize_market()/end_season(), which
-- now emit their own events, so they need no changes here.
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
    set status = 'closed'
    where status = 'open' and closes_at <= now()
    returning id, group_id
  loop
    perform _emit_notification_event('market_closed', rec.group_id, rec.id);
  end loop;

  for rec in
    select m.id
    from markets m
    join resolution_proposals rp on rp.market_id = m.id
    where m.status = 'proposed' and rp.proposed_at + interval '24 hours' <= now()
  loop
    perform finalize_market(rec.id);
  end loop;

  for rec in
    select m.id
    from markets m
    join challenges c on c.market_id = m.id
    where m.status = 'disputed' and c.created_at + interval '48 hours' <= now()
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
end;
$$;

revoke execute on function expire_stale() from public;
grant execute on function expire_stale() to service_role;
