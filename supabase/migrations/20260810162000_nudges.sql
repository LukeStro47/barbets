-- The two inactivity nudges, both emitted by one new cron sweep.
--
-- Deliberately NOT folded into expire_stale(). Everything in that function is
-- load-bearing (markets closing, votes finalizing, seasons archiving, groups
-- being deleted); these two are flavor. A bad query here shouldn't be able to
-- throw partway through and leave a season un-archived, so they get their own
-- job with its own failure domain, at a much slower cadence than expire_stale's
-- once-a-minute.
--
-- Both are group-scoped events. Who actually receives them is decided entirely
-- in get_event_recipients (see 20260810161000), which is also where the "hasn't
-- bet in a week" rule lives — this function only decides *whether there is
-- anything worth notifying about*, never who.

-- weekend_nudge is group-scoped with no market behind it (that's the point: the
-- group has nothing open), so it joins the allow-list. market_closing_soon is
-- about one specific market and carries a market_id like any other market event.
alter table notification_events drop constraint notification_events_market_events_have_market;
alter table notification_events add constraint notification_events_market_events_have_market check (
  (event_type in (
    'season_ended', 'betting_opened', 'member_joined',
    'group_deletion_scheduled', 'group_deletion_canceled', 'group_titles_updated',
    'season_betting_opened', 'group_deletion_scheduled_inactivity', 'admin_broadcast',
    'weekend_nudge'
  ))
  or (market_id is not null)
);

-- Stamped once per market, so the closing nudge can only ever fire once for a
-- given market no matter how often the sweep runs. Same one-shot pattern as
-- markets.closed_at, and cheaper than trying to derive it from event history.
alter table markets add column closing_nudge_sent_at timestamptz;

create function send_nudges()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  rec record;
begin
  -- (1) Friday-midday "the weekend's coming" prompt.
  --
  -- Fires in the group's *own* timezone (group_settings.timezone, which until
  -- now was purely a display caption next to closing times). A 15-minute window
  -- matched against a 15-minute cron cadence means exactly one tick can land
  -- inside it; the 5-day dedupe below is the real guarantee, and also covers a
  -- group whose owner changes the timezone mid-week.
  --
  -- Only quiet groups get it. A group with a market already open, or one
  -- started in the last few days, is having the exact conversation this push
  -- exists to start, so sending it there is pure noise.
  for rec in
    select g.id as group_id
    from groups g
    join group_settings gs on gs.group_id = g.id
    left join seasons s on s.group_id = g.id and s.status = 'active'
    where g.deletion_scheduled_at is null
      and extract(isodow from (now() at time zone gs.timezone)) = 5
      and (now() at time zone gs.timezone)::time >= time '12:00'
      and (now() at time zone gs.timezone)::time < time '12:15'
      and (case when gs.seasons_enabled then s.id is not null and s.betting_open else gs.betting_enabled end)
      and (select count(*) from memberships m where m.group_id = g.id and m.status = 'active') >= 2
      and not exists (
        select 1 from markets mk where mk.group_id = g.id and mk.status in ('pending_sponsor', 'open')
      )
      and not exists (
        select 1 from markets mk where mk.group_id = g.id and mk.created_at > now() - interval '3 days'
      )
      and not exists (
        select 1 from notification_events ne
        where ne.group_id = g.id
          and ne.event_type = 'weekend_nudge'
          and ne.created_at > now() - interval '5 days'
      )
  loop
    perform _emit_notification_event('weekend_nudge', rec.group_id, null, null, null);
  end loop;

  -- (2) "A market's about to close and you haven't bet in a while."
  --
  -- distinct on (group_id) caps this at one market per group per sweep, and the
  -- 24-hour lookback caps it at one per group per day: a group closing four
  -- markets at once should cost a lapsed member one push, not four. The cap is
  -- applied per group rather than per recipient because the recipient set is
  -- the same lapsed-member set either way, which makes the cheap check the
  -- correct one — no per-user delivery log needed.
  for rec in
    select distinct on (m.group_id) m.id as market_id, m.group_id
    from markets m
    join groups g on g.id = m.group_id
    where m.status = 'open'
      and m.closing_nudge_sent_at is null
      and m.closes_at > now()
      and m.closes_at <= now() + interval '2 hours'
      and g.deletion_scheduled_at is null
      and not exists (
        select 1 from notification_events ne
        where ne.group_id = m.group_id
          and ne.event_type = 'market_closing_soon'
          and ne.created_at > now() - interval '24 hours'
      )
    order by m.group_id, m.closes_at asc, m.id asc
  loop
    update markets set closing_nudge_sent_at = now() where id = rec.market_id;
    perform _emit_notification_event('market_closing_soon', rec.group_id, rec.market_id, null, null);
  end loop;
end;
$$;

revoke execute on function send_nudges() from public;
revoke execute on function send_nudges() from authenticated;
grant execute on function send_nudges() to service_role;

-- Every 15 minutes, not every minute: the Friday prompt has a 15-minute window
-- and the closing nudge fires ~2h out, so nothing here benefits from a tighter
-- interval, and a slower job is a smaller blast radius. Same best-effort
-- wrapping as the existing schedules, in case pg_cron isn't enabled.
do $$
begin
  perform cron.schedule('barbets-nudges', '*/15 * * * *', 'select send_nudges();');
exception when others then
  raise notice 'pg_cron scheduling for send_nudges skipped (%). Enable pg_cron in the Supabase dashboard, then run: select cron.schedule(''barbets-nudges'', ''*/15 * * * *'', ''select send_nudges();'');', sqlerrm;
end;
$$;
