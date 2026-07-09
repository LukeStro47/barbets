-- Turnout rule: a challenged vote with zero ballots, or a tie for first
-- place that includes the proposed outcome, now upholds the proposal
-- instead of voiding. Previously any tie or zero turnout voided the market
-- and refunded everyone, which made challenging a free "undo" for any
-- losing bettor betting on group apathy (nothing to lose, group indifference
-- wins it back). Now apathy/indecision defaults to the proposal, so
-- challenging is only worth it if you can actually rally votes against it.
--
--   - Zero ballots cast -> the proposed outcome wins outright.
--   - Tie for first place, proposal among the tied leaders -> proposal wins.
--   - Tie for first place, proposal NOT among the tied leaders -> VOID (the
--     group actively disagreed with the proposal but couldn't agree on the
--     alternative either — refund is the honest outcome there).
--   - An explicit VOID majority (outright, no tie) still voids — untouched,
--     this already falls out of the top-count select picking 'void' as the
--     outright winner.
create or replace function finalize_market(p_market_id uuid)
returns markets
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_id uuid := auth.uid();
  v_market markets%rowtype;
  v_proposal resolution_proposals%rowtype;
  v_challenge challenges%rowtype;
  v_outcome market_outcome;
  v_actual_value numeric;
  v_top_count int;
  v_tied_outcomes market_outcome[];
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

    if v_challenge.created_at + interval '24 hours' > now() and v_votes_cast < v_eligible_voters then
      raise exception 'invalid_operation: the vote window is still open';
    end if;

    select v.outcome, count(*) into v_outcome, v_top_count
    from votes v
    where v.market_id = p_market_id
    group by v.outcome
    order by count(*) desc
    limit 1;

    if v_top_count is null or v_top_count = 0 then
      -- Nobody voted: apathy upholds the proposal instead of voiding it.
      v_outcome := v_proposal.proposed_outcome;
    else
      select array_agg(outcome) into v_tied_outcomes
      from (
        select v.outcome
        from votes v
        where v.market_id = p_market_id
        group by v.outcome
        having count(*) = v_top_count
      ) ties;

      if array_length(v_tied_outcomes, 1) > 1 then
        if v_proposal.proposed_outcome = any(v_tied_outcomes) then
          v_outcome := v_proposal.proposed_outcome;
        else
          v_outcome := 'void';
        end if;
      end if;
      -- else: outright winner (possibly 'void' itself) stands as-is.
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
    perform _emit_notification_event('market_resolved', v_market.group_id, v_market.id, null, v_actor_id);
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
    perform _emit_notification_event('market_resolved', v_market.group_id, v_market.id, null, v_actor_id);
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

  perform _emit_notification_event('market_resolved', v_market.group_id, v_market.id, null, v_actor_id);

  return v_market;
end;
$$;

revoke execute on function finalize_market(uuid) from public;
grant execute on function finalize_market(uuid) to authenticated;
