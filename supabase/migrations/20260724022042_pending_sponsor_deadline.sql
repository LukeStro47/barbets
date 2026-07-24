-- pending_sponsor markets shouldn't be endorsable (or left lingering) once there's
-- barely any time left to actually bet before closes_at — endorsing at that point
-- would open a market nobody has a real chance to bet on. Two changes:
--   1. sponsor_market() rejects endorsing inside the last 5 minutes before closes_at
--      (or after it's already passed).
--   2. expire_stale()'s existing unsponsored-expiry sweep now also catches markets
--      hitting that same 5-minute cutoff, not just the original 72h-since-creation
--      rule — whichever condition trips first force-voids it the same way (no bets
--      exist yet on a pending_sponsor market, so there's nothing to refund).
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

  if v_market.status <> 'pending_sponsor' then
    raise exception 'invalid_operation: market is already sponsored or has expired';
  end if;

  if v_market.closes_at < now() + interval '5 minutes' then
    raise exception 'invalid_operation: too little time is left before betting closes to endorse this market now';
  end if;

  if v_user_id = v_market.creator_id then
    raise exception 'invalid_operation: the creator cannot sponsor their own market';
  end if;

  perform 1 from memberships where group_id = v_market.group_id and user_id = v_user_id and status <> 'removed';
  if not found then
    raise exception 'not_found: not a member of this group';
  end if;

  update markets set sponsor_id = v_user_id, status = 'open'
  where id = p_market_id
  returning * into v_market;

  return v_market;
end;
$$;

revoke execute on function sponsor_market(uuid) from public;
grant execute on function sponsor_market(uuid) to authenticated;

create or replace function expire_stale()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  rec record;
  rec2 record;
begin
  for rec in
    select id from markets
    where status = 'pending_sponsor'
      and (created_at < now() - interval '72 hours' or closes_at < now() + interval '5 minutes')
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
    where m.status = 'proposed' and rp.proposed_at + interval '8 hours' <= now()
  loop
    perform finalize_market(rec.id);
  end loop;

  for rec in
    select m.id
    from markets m
    join challenges c on c.market_id = m.id
    where m.status = 'disputed' and c.created_at + interval '8 hours' <= now()
  loop
    perform finalize_market(rec.id);
  end loop;

  -- Wind-down hard cap: force-void anything still proposed/disputed once a
  -- winding_down season's grace window has elapsed, then archive it. Most
  -- winding-down seasons never reach here at all — finalize_market()'s tail
  -- hook already archives the moment the last in-flight market clears
  -- naturally (via the two loops just above, or a direct owner/voter call).
  for rec in
    select m.id
    from seasons s
    join markets m on m.season_id = s.id
    where s.status = 'winding_down' and s.wind_down_deadline <= now()
      and m.status in ('proposed', 'disputed')
    for update of m
  loop
    perform _void_market(rec.id);
  end loop;

  for rec in
    select id from seasons where status = 'winding_down' and wind_down_deadline <= now()
  loop
    perform _maybe_archive_winding_down_season(rec.id);
  end loop;

  for rec in
    select group_id from seasons where status = 'active' and ends_at is not null and ends_at <= now()
  loop
    perform end_season(rec.group_id);
  end loop;

  for rec in
    select s.group_id
    from seasons s
    join groups g on g.id = s.group_id
    where s.status = 'intermission'
      and s.started_at <= now() - interval '30 days'
      and g.deletion_scheduled_at is null
  loop
    for rec2 in
      select id from markets
      where group_id = rec.group_id and status not in ('resolved', 'voided')
      for update
    loop
      -- Defensive: intermission means no active season, so nothing new
      -- could've been created since the group entered it — this should
      -- already be an empty set every time.
      perform _void_market(rec2.id);
    end loop;

    update groups set deletion_scheduled_at = now() + interval '5 days' where id = rec.group_id;
    perform _emit_notification_event('group_deletion_scheduled_inactivity', rec.group_id, null, null, null);
  end loop;

  for rec in
    select id from groups
    where deletion_scheduled_at is not null and deletion_scheduled_at <= now()
  loop
    delete from groups where id = rec.id;
  end loop;

  delete from notification_events
  where processed_at is not null and processed_at < now() - interval '30 days';
end;
$$;

revoke execute on function expire_stale() from public;
revoke execute on function expire_stale() from authenticated;
grant execute on function expire_stale() to service_role;
