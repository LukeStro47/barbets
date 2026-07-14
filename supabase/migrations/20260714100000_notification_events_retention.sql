-- notification_events has no retention policy: processed rows are marked
-- via processed_at, never deleted (see send-push/index.ts), so the table
-- grows forever. Nothing in the app queries events by age, and the unprocessed
-- partial index already keeps the drain query cheap regardless of table
-- size, but there's no reason to keep old rows around indefinitely. Folded
-- into expire_stale() (already running every minute) rather than a new
-- pg_cron job, since one more thing for that same cron entry to do is
-- simpler than registering and maintaining a second schedule. 30 days is
-- comfortably past the Edge Function's own drain time (seconds to minutes)
-- and any manual debugging after the fact.
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

  delete from notification_events
  where processed_at is not null and processed_at < now() - interval '30 days';
end;
$$;

revoke execute on function expire_stale() from public;
revoke execute on function expire_stale() from authenticated;
grant execute on function expire_stale() to service_role;
