-- A cross-group-isolation test caught a systemic ordering bug: several
-- functions checked market/season *status* (or ownership) before checking
-- whether the caller belongs to the group at all. A complete stranger —
-- not a subject, not even a member — could learn a market's lifecycle
-- state ("betting is not open") or a group's existence ("only the owner
-- can...") before ever being told not_found. The fix is the same
-- discipline already used elsewhere: existence check, then subject check,
-- then membership check, ALL before any status/business-rule validation
-- that would reveal something about the resource to someone with no
-- business knowing it exists. Full function bodies below (unchanged logic,
-- reordered checks only).

create or replace function place_bet(p_market_id uuid, p_side bet_side, p_amount int)
returns bets
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_market markets%rowtype;
  v_cap_pct int;
  v_membership memberships%rowtype;
  v_max_bet int;
  v_bet bets%rowtype;
begin
  select * into v_market from markets where id = p_market_id for update;
  if v_market.id is null then
    raise exception 'not_found: market not found';
  end if;

  if exists (select 1 from market_subjects where market_id = p_market_id and user_id = v_user_id) then
    raise exception 'not_found: market not found';
  end if;

  select * into v_membership
  from memberships
  where group_id = v_market.group_id and user_id = v_user_id
  for update;

  if v_membership.id is null or v_membership.status = 'removed' then
    raise exception 'not_found: not a member of this group';
  end if;

  if v_market.status <> 'open' or v_market.closes_at <= now() then
    raise exception 'invalid_operation: betting is not open on this market';
  end if;

  if (v_market.market_type = 'yes_no' and p_side not in ('yes', 'no'))
     or (v_market.market_type = 'over_under' and p_side not in ('over', 'under')) then
    raise exception 'invalid_operation: side does not match market type';
  end if;

  if v_membership.status = 'dormant' then
    raise exception 'invalid_operation: dormant members cannot bet — opt in to the current season first';
  end if;

  if v_membership.balance < 1 then
    raise exception 'insufficient_balance: you have no tokens to bet';
  end if;

  select coalesce(s.bet_cap_pct, gs.bet_cap_pct) into v_cap_pct
  from group_settings gs
  left join seasons s on s.id = v_market.season_id
  where gs.group_id = v_market.group_id;

  v_max_bet := greatest(1, floor(v_membership.balance * v_cap_pct / 100.0)::int);
  if v_max_bet > v_membership.balance then
    v_max_bet := v_membership.balance;
  end if;

  if p_amount < 1 or p_amount > v_max_bet then
    raise exception 'invalid_operation: amount must be between 1 and your current cap of %', v_max_bet;
  end if;

  insert into bets (market_id, user_id, side, amount)
  values (p_market_id, v_user_id, p_side, p_amount)
  returning * into v_bet;

  update memberships set balance = balance - p_amount where id = v_membership.id;

  insert into ledger (membership_id, amount, reason, market_id, bet_id)
  values (v_membership.id, -p_amount, 'bet', p_market_id, v_bet.id);

  return v_bet;
end;
$$;

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

  return v_market;
end;
$$;

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

  return v_proposal;
end;
$$;

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

  return v_challenge;
end;
$$;

create or replace function cast_vote(p_market_id uuid, p_outcome bet_side)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_market markets%rowtype;
  v_challenge challenges%rowtype;
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

  if v_market.status <> 'disputed' then
    raise exception 'invalid_operation: market is not open for voting';
  end if;

  select * into v_challenge from challenges where market_id = p_market_id;
  if v_challenge.created_at + interval '48 hours' <= now() then
    raise exception 'invalid_operation: voting has closed';
  end if;

  if (v_market.market_type = 'yes_no' and p_outcome not in ('yes', 'no'))
     or (v_market.market_type = 'over_under' and p_outcome not in ('over', 'under')) then
    raise exception 'invalid_operation: outcome does not match market type';
  end if;

  insert into votes (market_id, voter_id, outcome)
  values (p_market_id, v_user_id, p_outcome)
  on conflict (market_id, voter_id) do update set outcome = excluded.outcome, created_at = now();
end;
$$;

-- Owner-gated group functions: a complete stranger who guesses/leaks a
-- group_id should get not_found, not a 'forbidden' that confirms the group
-- exists. A legitimate (non-owner) member getting 'forbidden' is fine —
-- they already have real visibility into the group.

create or replace function remove_member(p_group_id uuid, p_target_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_group groups%rowtype;
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
    raise exception 'forbidden: only the group owner can remove members';
  end if;
  if p_target_user_id = v_group.owner_id then
    raise exception 'invalid_operation: the owner cannot remove themself';
  end if;

  perform 1 from memberships
  where group_id = p_group_id and user_id = p_target_user_id and status <> 'removed'
  for update;
  if not found then
    raise exception 'not_found: user is not a member of this group';
  end if;

  for rec in
    select m.id
    from markets m
    join market_subjects ms on ms.market_id = m.id
    where m.group_id = p_group_id
      and ms.user_id = p_target_user_id
      and m.status not in ('resolved', 'voided')
    for update of m
  loop
    perform _void_market(rec.id);
  end loop;

  for rec in
    select b.id
    from bets b
    join markets m on m.id = b.market_id
    where b.user_id = p_target_user_id
      and m.group_id = p_group_id
      and m.status not in ('resolved', 'voided')
      and b.settled_at is null
  loop
    perform _refund_single_bet(rec.id);
  end loop;

  update memberships set status = 'removed'
  where group_id = p_group_id and user_id = p_target_user_id;
end;
$$;

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

  select coalesce(max(number), 0) + 1 into v_next_number from seasons where group_id = p_group_id;

  insert into seasons (group_id, number, status)
  values (p_group_id, v_next_number, 'intermission');
end;
$$;

create or replace function start_season(p_group_id uuid)
returns seasons
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_group groups%rowtype;
  v_settings group_settings%rowtype;
  v_season seasons%rowtype;
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
    raise exception 'forbidden: only the group owner can start the season';
  end if;

  select * into v_settings from group_settings where group_id = p_group_id;

  select * into v_season from seasons where group_id = p_group_id and status = 'intermission' for update;
  if v_season.id is null then
    raise exception 'invalid_operation: no season is in intermission — end the current season first';
  end if;

  update seasons
  set status = 'active', started_at = now(),
      seed_amount = v_settings.seed_amount, bet_cap_pct = v_settings.bet_cap_pct
  where id = v_season.id
  returning * into v_season;

  for rec in
    select user_id from season_optins where season_id = v_season.id
  loop
    update memberships
    set status = 'active', balance = v_season.seed_amount
    where group_id = p_group_id and user_id = rec.user_id;

    insert into ledger (membership_id, amount, reason)
    select id, v_season.seed_amount, 'seed'
    from memberships where group_id = p_group_id and user_id = rec.user_id;
  end loop;

  update memberships
  set status = 'dormant'
  where group_id = p_group_id
    and status <> 'removed'
    and user_id not in (select user_id from season_optins where season_id = v_season.id);

  return v_season;
end;
$$;

create or replace function opt_in_season(p_season_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_season seasons%rowtype;
  v_row_count int;
begin
  select * into v_season from seasons where id = p_season_id for update;
  if v_season.id is null then
    raise exception 'not_found: season not found';
  end if;

  perform 1 from memberships
  where group_id = v_season.group_id and user_id = v_user_id and status <> 'removed';
  if not found then
    raise exception 'not_found: not a member of this group';
  end if;

  if v_season.status not in ('intermission', 'active') then
    raise exception 'invalid_operation: this season is no longer accepting opt-ins';
  end if;

  insert into season_optins (season_id, user_id)
  values (p_season_id, v_user_id)
  on conflict do nothing;

  get diagnostics v_row_count = row_count;

  if v_season.status = 'active' and v_row_count > 0 then
    update memberships
    set status = 'active', balance = v_season.seed_amount
    where group_id = v_season.group_id and user_id = v_user_id;

    insert into ledger (membership_id, amount, reason)
    select id, v_season.seed_amount, 'seed'
    from memberships where group_id = v_season.group_id and user_id = v_user_id;
  end if;
end;
$$;
