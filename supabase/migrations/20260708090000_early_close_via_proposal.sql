-- Early close via early resolution proposal: propose_resolution() may now be
-- called on an 'open' market (not just 'closed'), letting a member lock
-- betting the moment the real-world outcome is already known instead of
-- waiting out closes_at. Race safety is free: propose_resolution() and
-- place_bet() both `select ... for update` the same markets row, so whichever
-- transaction's lock lands first wins and the other observes the post-commit
-- status (the same pattern expire_stale() already relies on).
--
-- closed_at records when betting actually locked (early-by-proposal or
-- on-time via expire_stale()), independent of closes_at (which stays the
-- *latest* possible close) — the reveal/market pages use
-- `closed_at < closes_at` to show "closed early by proposal."

alter table markets add column closed_at timestamptz;

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
  v_was_open boolean;
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

  if v_market.status not in ('open', 'closed') then
    raise exception 'invalid_operation: market is not awaiting a resolution proposal';
  end if;
  v_was_open := (v_market.status = 'open');

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

  update markets
  set status = 'proposed', closed_at = coalesce(closed_at, now())
  where id = p_market_id;

  -- Betting was still open a moment ago — the group never got the normal
  -- "odds are live" push, so send it before (and separately from) the
  -- proposal notification. A market that was already 'closed' got this one
  -- earlier, from expire_stale().
  if v_was_open then
    perform _emit_notification_event('market_closed', v_market.group_id, p_market_id, null, v_user_id);
  end if;

  perform _emit_notification_event('resolution_proposed', v_market.group_id, p_market_id, null, v_user_id);

  return v_proposal;
end;
$$;

revoke execute on function propose_resolution(uuid, market_outcome, text, numeric) from public;
grant execute on function propose_resolution(uuid, market_outcome, text, numeric) to authenticated;

-- expire_stale()'s open->closed step now stamps closed_at too, so an
-- on-time close and an early-by-proposal close are both recorded the same
-- way.
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
    set status = 'closed', closed_at = now()
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
    where m.status = 'disputed' and c.created_at + interval '24 hours' <= now()
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
revoke execute on function expire_stale() from authenticated;
grant execute on function expire_stale() to service_role;
