-- Neither nudge belongs in a public (directory-joined, pipeline-driven) group: weekend_nudge
-- ("anyone up to something worth betting on?") and market_closing_soon ("it's been a minute
-- since your last one") are both about a real friend group going quiet, which doesn't describe
-- NFL/CFB/Weather — nobody there is "between markets" on purpose, the pipeline just hasn't run
-- yet. In practice this was the source of the "it's been a while"-style noise members were
-- seeing on those groups. Same reasoning already applied to impressive_bet and
-- resolution_proposed for public groups (20260830260000, 20260830270000) — see
-- ARCHITECTURE.md's "Notification volume on these groups needed four separate fixes" note,
-- now a fifth.
create or replace function send_nudges()
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
      and not g.is_public
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
      and not g.is_public
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
