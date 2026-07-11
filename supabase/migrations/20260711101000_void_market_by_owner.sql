-- void_market_by_owner: an owner kill switch for a single market, at any
-- stage before it's already settled (pending_sponsor through disputed).
-- Refunds every stake exactly (refund_all_bets(), the same helper VOID
-- resolutions and season-end/member-removal force-voids already use — it
-- also correctly drains any bonus_pool this market was carrying, per the
-- distribute_payout redistribution chain). Deliberately not folded into
-- finalize_market()'s VOID branch: this is an unconditional admin override
-- available regardless of proposal/vote state, not another way to reach the
-- same tally-driven outcome.
create or replace function void_market_by_owner(p_market_id uuid)
returns markets
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_market markets%rowtype;
  v_group groups%rowtype;
begin
  select * into v_market from markets where id = p_market_id for update;
  if v_market.id is null then
    raise exception 'not_found: market not found';
  end if;

  -- 404-not-403: an owner who happens to be this market's subject still
  -- can't act on a market they're not supposed to know exists.
  if exists (select 1 from market_subjects where market_id = p_market_id and user_id = v_caller) then
    raise exception 'not_found: market not found';
  end if;

  select * into v_group from groups where id = v_market.group_id;
  if v_caller <> v_group.owner_id then
    raise exception 'forbidden: only the group owner can void a market';
  end if;

  if v_market.status in ('resolved', 'voided') then
    raise exception 'invalid_operation: this market has already been settled';
  end if;

  perform refund_all_bets(p_market_id);

  update resolution_proposals set finalized = true where market_id = p_market_id;

  update markets
  set status = 'voided', outcome = 'void', outcome_option_id = null, resolved_at = now()
  where id = p_market_id
  returning * into v_market;

  perform _emit_notification_event('market_voided', v_market.group_id, v_market.id, null, v_caller);

  return v_market;
end;
$$;

revoke execute on function void_market_by_owner(uuid) from public;
grant execute on function void_market_by_owner(uuid) to authenticated;

-- get_event_recipients: market_voided is market-scoped like market_resolved
-- and, same reasoning, subjects are the whole point of the push (the
-- market just became visible to them too, since voided/resolved both lift
-- the privacy gate) — so it joins market_resolved in the p_include_subjects
-- branch instead of falling into the subject-excluded default.
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
  elsif v_event.event_type in ('season_ended', 'betting_opened') then
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
