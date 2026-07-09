-- Shared money-settlement helpers used by finalize_market(), end_season(),
-- and remove_member(). None of these are meant to be called directly by
-- clients — no EXECUTE grant to authenticated on any function in this file,
-- only the higher-level entry points that use them internally (which can
-- call them regardless of grants, since a SECURITY DEFINER function runs as
-- its owner, who always has implicit rights on their own functions).

-- Refunds every still-open bet on a market its exact stake back, and marks
-- the market itself voided. Used for: an explicit VOID resolution outcome,
-- a winning side with zero bets, and force-voiding at season end / member
-- removal. Idempotent: only touches bets with settled_at is null, so a bet
-- already refunded early (e.g. by remove_member()) is never double-credited.
create or replace function refund_all_bets(p_market_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group_id uuid;
  rec record;
begin
  select group_id into v_group_id from markets where id = p_market_id;

  for rec in
    update bets
    set payout = amount, settled_at = now()
    where market_id = p_market_id and settled_at is null
    returning id, user_id, amount
  loop
    update memberships
    set balance = balance + rec.amount
    where group_id = v_group_id and user_id = rec.user_id;

    insert into ledger (membership_id, amount, reason, market_id, bet_id)
    select id, rec.amount, 'refund', p_market_id, rec.id
    from memberships
    where group_id = v_group_id and user_id = rec.user_id;
  end loop;
end;
$$;

revoke execute on function refund_all_bets(uuid) from public;

-- Force-voids a single market outside the normal proposal/challenge/vote
-- flow (season end, member removal) — refunds everyone, no proposal record
-- required.
create or replace function _void_market(p_market_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform refund_all_bets(p_market_id);
  update markets
  set status = 'voided', outcome = 'void', resolved_at = now()
  where id = p_market_id;
end;
$$;

revoke execute on function _void_market(uuid) from public;

-- Refunds exactly one bet without touching the rest of the market's pool —
-- used by remove_member() for a removed member's bets in markets they are
-- not a subject of (those markets stay open for everyone else; only the
-- removed member's own stake comes back).
create or replace function _refund_single_bet(p_bet_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bet bets%rowtype;
  v_group_id uuid;
begin
  select * into v_bet from bets where id = p_bet_id and settled_at is null for update;
  if v_bet.id is null then
    return; -- already settled — nothing to do, idempotent
  end if;

  select group_id into v_group_id from markets where id = v_bet.market_id;

  update bets set payout = amount, settled_at = now() where id = p_bet_id;

  update memberships
  set balance = balance + v_bet.amount
  where group_id = v_group_id and user_id = v_bet.user_id;

  insert into ledger (membership_id, amount, reason, market_id, bet_id)
  select id, v_bet.amount, 'refund', v_bet.market_id, p_bet_id
  from memberships
  where group_id = v_group_id and user_id = v_bet.user_id;
end;
$$;

revoke execute on function _refund_single_bet(uuid) from public;
