-- finalize_market: the single entry point that turns a 'proposed' or
-- 'disputed' market into 'resolved' or 'voided'. Handles both timer paths:
--   - 'proposed' + 24h elapsed since the proposal, unchallenged -> accept
--     the proposed outcome as-is.
--   - 'disputed' + 48h elapsed since the challenge -> tally votes among the
--     market's real sides; simple majority wins; a tie for first place, or
--     zero votes cast, -> VOID.
-- Idempotent and safe to call early: if the relevant window hasn't elapsed
-- yet, it raises rather than doing anything.
--
-- Parimutuel payout (the money-critical core): each winning bet's base
-- payout is floor(bet.amount * total_pool / winning_pool); the remainder
-- ("dust") left over from flooring goes entirely to the single largest
-- winning stake, ties broken by earliest bet then by bet id. This
-- construction guarantees sum(payout) == total_pool exactly, by
-- construction — no tokens are ever created or destroyed. A one-sided
-- market (winning side has literally every bet) falls out of the same
-- formula automatically: total_pool == winning_pool, so base_payout ==
-- amount for every bettor and dust is zero. A winning side with zero bets,
-- or an explicit VOID outcome, both take the refund_all_bets() path
-- instead — every stake back, exactly.
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
  v_winning_side bet_side;
  v_top_count int;
  v_tie_count int;
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
    if v_challenge.created_at + interval '48 hours' > now() then
      raise exception 'invalid_operation: the vote window is still open';
    end if;

    select v.outcome, count(*) into v_winning_side, v_top_count
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
      else
        v_outcome := v_winning_side::text::market_outcome;
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

  -- losing bets: settle at payout 0, no balance/ledger change.
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
