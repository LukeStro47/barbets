-- propose_resolution: requires status = 'closed' — betting must have
-- actually locked first. proposed_outcome may be VOID directly (e.g.
-- "criteria unmet"); actual_value is only meaningful for OVER_UNDER
-- markets. Proposals are not secret (see the RLS policy comment in
-- 20260707120835_rls_policies.sql) — everyone needs to see a pending
-- proposal to decide whether to challenge it.
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

  perform 1 from memberships where group_id = v_market.group_id and user_id = v_user_id and status <> 'removed';
  if not found then
    raise exception 'not_found: not a member of this group';
  end if;

  insert into resolution_proposals (market_id, proposer_id, proposed_outcome, justification, actual_value)
  values (p_market_id, v_user_id, p_outcome, p_justification, p_actual_value)
  returning * into v_proposal;

  update markets set status = 'proposed' where id = p_market_id;

  return v_proposal;
end;
$$;

revoke execute on function propose_resolution(uuid, market_outcome, text, numeric) from public;
grant execute on function propose_resolution(uuid, market_outcome, text, numeric) to authenticated;

-- challenge_resolution: one challenge is enough to move a market to a vote
-- (challenges.market_id is unique) — a second challenge attempt just hits
-- that constraint. Must land within the 24h window from when the proposal
-- was made.
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

  perform 1 from memberships where group_id = v_market.group_id and user_id = v_user_id and status <> 'removed';
  if not found then
    raise exception 'not_found: not a member of this group';
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

revoke execute on function challenge_resolution(uuid, text) from public;
grant execute on function challenge_resolution(uuid, text) to authenticated;

-- cast_vote: secret ballot (RLS hides it from everyone but the voter until
-- are_votes_revealed() flips true at tally time). Upsert so a member can
-- change their mind any time before the 48h window closes. Members with
-- bets may vote — see the spec's rationale that excluding interested
-- parties in a small group would leave nobody, and the challenge mechanism
-- plus post-close ballot reveal keeps people honest.
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

  perform 1 from memberships where group_id = v_market.group_id and user_id = v_user_id and status <> 'removed';
  if not found then
    raise exception 'not_found: not a member of this group';
  end if;

  insert into votes (market_id, voter_id, outcome)
  values (p_market_id, v_user_id, p_outcome)
  on conflict (market_id, voter_id) do update set outcome = excluded.outcome, created_at = now();
end;
$$;

revoke execute on function cast_vote(uuid, bet_side) from public;
grant execute on function cast_vote(uuid, bet_side) to authenticated;
