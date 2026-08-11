-- refund_all_bets() drained the voided market's own bonus_pool across "every
-- currently-open market in the group" — and did not exclude the market being
-- voided. That only mattered for the callers that refund *before* flipping
-- status, on a market that is still 'open' at the time:
--
--   * void_market_by_owner() / void_market_by_creator() — the owner kill
--     switch is explicitly allowed from pending_sponsor through disputed, so
--     an owner voiding a live market hits this every time.
--   * _void_market() — the zero-bet auto-void in expire_stale(), member
--     removal, and the intermission sweep, all of which force-void markets
--     that are still 'open'.
--
-- In those cases the market handed its own bonus_pool back to itself (the
-- whole thing, when it was the only open market in the group) and the
-- unconditional `update markets set bonus_pool = 0` immediately below then
-- destroyed it. The tokens did not reach another market and did not reach
-- groups.pending_bonus_pool either: they left the group's economy entirely.
--
-- The VOID-resolution path never showed it because propose_resolution() moves
-- the market to 'proposed' before finalize_market() refunds, so it was already
-- out of the 'open' set by then. That is also why the existing coverage in
-- money.payout_distribution.test.ts passed while the owner-void path leaked.
--
-- Excluding p_market_id is right for every caller, not just the ones above: a
-- market that is giving its bonus away is never a valid recipient of it.
create or replace function refund_all_bets(p_market_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_market markets%rowtype;
  v_other_market_ids uuid[];
  v_n int;
  v_share int;
  v_dust int;
  rec record;
begin
  select * into v_market from markets where id = p_market_id;

  for rec in
    update bets
    set payout = amount, settled_at = now()
    where market_id = p_market_id and settled_at is null
    returning id, user_id, amount
  loop
    update memberships
    set balance = balance + rec.amount
    where group_id = v_market.group_id and user_id = rec.user_id;

    insert into ledger (membership_id, amount, reason, market_id, bet_id)
    select id, rec.amount, 'refund', p_market_id, rec.id
    from memberships
    where group_id = v_market.group_id and user_id = rec.user_id;
  end loop;

  if v_market.bonus_pool > 0 then
    select array_agg(id order by created_at asc, id asc) into v_other_market_ids
    from markets
    where group_id = v_market.group_id and status = 'open' and id <> p_market_id;

    if v_other_market_ids is not null and array_length(v_other_market_ids, 1) > 0 then
      v_n := array_length(v_other_market_ids, 1);
      v_share := floor(v_market.bonus_pool::numeric / v_n)::int;
      v_dust := v_market.bonus_pool - v_share * v_n;

      update markets
      set bonus_pool = bonus_pool + v_share + (case when id = v_other_market_ids[1] then v_dust else 0 end)
      where id = any(v_other_market_ids);
    else
      update groups set pending_bonus_pool = pending_bonus_pool + v_market.bonus_pool where id = v_market.group_id;
    end if;

    update markets set bonus_pool = 0 where id = p_market_id;
  end if;
end;
$$;

revoke execute on function refund_all_bets(uuid) from public;
revoke execute on function refund_all_bets(uuid) from authenticated;
