-- A market that reaches closes_at with literally zero bets ever placed has
-- nothing for anyone to propose/challenge/vote on — before this, it just sat
-- in 'closed' forever (or until a season/group sweep force-voided it much
-- later) waiting for a proposal nobody had any reason to make. Now the same
-- expire_stale() sweep that would've closed it voids it outright instead,
-- via the shared _void_market() helper (refund_all_bets() is a no-op here
-- since there's nothing to refund, but it's still the one place that drains
-- any inherited bonus_pool). Deliberately silent, no notification emitted
-- either way — same convention the unsponsored pending_sponsor expiry above
-- already uses for "nothing happened here" auto-voids (that path also can't
-- emit market_closed since it never reaches 'closed' at all, same as this
-- one now doesn't). Only the natural closes_at sweep is affected; a manual
-- propose_resolution on a zero-bet market is still a deliberate human action
-- and untouched. Full body copied forward from
-- 20260724040214_shorten_sponsor_deadline_to_24h.sql per that migration's
-- own note about why copying the true latest body matters here.
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
      and (created_at < now() - interval '24 hours' or closes_at <= now())
    for update
  loop
    update markets set status = 'voided', outcome = 'void', resolved_at = now()
    where id = rec.id;
  end loop;

  for rec in
    select id, group_id from markets
    where status = 'open' and closes_at <= now()
    for update
  loop
    if exists (select 1 from bets where market_id = rec.id) then
      update markets set status = 'closed', closed_at = now() where id = rec.id;
      perform _emit_notification_event('market_closed', rec.group_id, rec.id);
    else
      perform _void_market(rec.id);
    end if;
  end loop;

  for rec in
    select m.id
    from markets m
    join resolution_proposals rp on rp.market_id = m.id
    join group_settings gs on gs.group_id = m.group_id
    where m.status = 'proposed' and rp.proposed_at + (gs.resolution_window_hours * interval '1 hour') <= now()
  loop
    perform finalize_market(rec.id);
  end loop;

  for rec in
    select m.id
    from markets m
    join challenges c on c.market_id = m.id
    join group_settings gs on gs.group_id = m.group_id
    where m.status = 'disputed' and c.created_at + (gs.resolution_window_hours * interval '1 hour') <= now()
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
