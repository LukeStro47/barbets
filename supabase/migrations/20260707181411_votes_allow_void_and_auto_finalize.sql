-- Two product changes requested after using the app for real:
-- 1. VOID becomes an explicit ballot choice, not just the automatic
--    tie/zero-turnout fallback — a voter who thinks the market is
--    unresolvable can say so directly. A majority VOID vote resolves the
--    market as voided, same as a tie does.
-- 2. A disputed market finalizes as soon as every eligible (non-subject,
--    non-removed) member has voted, instead of always waiting the full 48h.

-- votes.outcome widens from bet_side to market_outcome (adds 'void'). All
-- existing values are valid in both types, so the cast is lossless.
alter table votes alter column outcome type market_outcome using outcome::text::market_outcome;

-- The old bet_side-typed overload must be dropped, not left alongside the
-- new one — two RPCs with the same name/argument names but different
-- argument types make PostgREST unable to pick a candidate for a JSON call.
drop function if exists cast_vote(uuid, bet_side);

create or replace function cast_vote(p_market_id uuid, p_outcome market_outcome)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_market markets%rowtype;
  v_challenge challenges%rowtype;
  v_eligible_voters int;
  v_votes_cast int;
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

  if (v_market.market_type = 'yes_no' and p_outcome not in ('yes', 'no', 'void'))
     or (v_market.market_type = 'over_under' and p_outcome not in ('over', 'under', 'void')) then
    raise exception 'invalid_operation: outcome does not match market type';
  end if;

  insert into votes (market_id, voter_id, outcome)
  values (p_market_id, v_user_id, p_outcome)
  on conflict (market_id, voter_id) do update set outcome = excluded.outcome, created_at = now();

  -- Early finalize: once every eligible voter has cast a ballot, there's no
  -- reason to make everyone wait out the rest of the 48h window.
  select count(*) into v_eligible_voters
  from memberships m
  where m.group_id = v_market.group_id
    and m.status <> 'removed'
    and not exists (select 1 from market_subjects ms where ms.market_id = p_market_id and ms.user_id = m.user_id);

  select count(distinct voter_id) into v_votes_cast from votes where market_id = p_market_id;

  if v_votes_cast >= v_eligible_voters then
    perform finalize_market(p_market_id);
  end if;
end;
$$;

revoke execute on function cast_vote(uuid, market_outcome) from public;
grant execute on function cast_vote(uuid, market_outcome) to authenticated;

-- finalize_market: the disputed branch now (a) allows finalizing early when
-- turnout is complete, not just when the 48h window has elapsed, and (b)
-- tallies market_outcome directly (including an explicit VOID majority),
-- so no more bet_side<->market_outcome casting is needed.
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

  return v_market;
end;
$$;

revoke execute on function finalize_market(uuid) from public;
grant execute on function finalize_market(uuid) to authenticated;
