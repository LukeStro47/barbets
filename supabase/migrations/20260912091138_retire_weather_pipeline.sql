-- Retires the Weather pipeline outright. The Weather public group itself was deleted directly
-- (2026-09-12), but everything that used to feed it kept running against a group that no longer
-- exists: pipeline_settings still had it enabled, and both weather-create-markets (daily) and
-- weather-resolve-markets (every 30 minutes) were still scheduled and firing, each presumably
-- failing (or no-op'ing) against a missing group on every run since. This migration turns all of
-- that off and strips the now-dead 'Weather' branch out of every function that special-cased it
-- by name, alongside the weather-create-markets/weather-resolve-markets Edge Functions being
-- deleted from the repo and undeployed in the same change. NFL and CFB are unaffected.
do $$
begin
  perform cron.unschedule('barbets-weather-create-markets');
  perform cron.unschedule('barbets-weather-resolve-markets');
exception when others then
  raise notice 'pg_cron unschedule for the weather pipeline skipped (%) -- nothing to do if pg_cron is disabled in this environment or the jobs were never scheduled here.', sqlerrm;
end;
$$;

delete from pipeline_settings where pipeline = 'weather';

alter table pipeline_settings drop constraint if exists pipeline_settings_pipeline_check;
alter table pipeline_settings add constraint pipeline_settings_pipeline_check check (pipeline in ('sports'));

-- _prune_resolved_system_markets(): identical shape to 20260906103000's version, minus Weather.
-- Every remaining pruned group (NFL, CFB) keeps 20, so the per-group case split is gone too.
create or replace function _prune_resolved_system_markets()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group record;
  v_market record;
begin
  for v_group in
    select id from groups where name in ('NFL', 'CFB') and is_public = true
  loop
    for v_market in
      select id from markets
      where group_id = v_group.id
        and is_system_market = true
        and status in ('resolved', 'voided')
      order by resolved_at desc
      offset 20
    loop
      delete from markets where id = v_market.id;
    end loop;
  end loop;
end;
$$;

revoke execute on function _prune_resolved_system_markets() from public;
revoke execute on function _prune_resolved_system_markets() from authenticated;
grant execute on function _prune_resolved_system_markets() to service_role;

-- get_member_stats(): identical to 20260906103000's version, minus Weather from the
-- pruned-pipeline-group name list that nulls out accuracy/wagered/settled-bets/best-call.
create or replace function get_member_stats(p_membership_id uuid)
returns table (
  membership_id uuid,
  group_id uuid,
  user_id uuid,
  nickname citext,
  balance int,
  joined_at timestamptz,
  net bigint,
  accuracy_pct int,
  settled_bet_count int,
  tokens_wagered bigint,
  best_call_multiple numeric,
  best_call_title text
)
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_target memberships%rowtype;
  v_is_pruned_pipeline_group boolean;
begin
  select * into v_target from memberships where id = p_membership_id;
  if v_target.id is null or v_target.status = 'removed' then
    raise exception 'not_found: member not found';
  end if;

  if not _caller_is_active_group_member(v_target.group_id) then
    raise exception 'not_found: member not found';
  end if;

  select exists (
    select 1 from groups g where g.id = v_target.group_id and g.is_public and g.name in ('NFL', 'CFB')
  ) into v_is_pruned_pipeline_group;

  return query
  with resolved_bets as (
    select b.side, b.option_id, m.outcome, m.outcome_option_id
    from bets b
    join markets m on m.id = b.market_id
    where b.user_id = v_target.user_id and m.group_id = v_target.group_id and m.status = 'resolved'
  ),
  settled as (
    select b.market_id, b.amount, b.payout, mk.title
    from bets b
    join markets mk on mk.id = b.market_id
    where b.user_id = v_target.user_id and mk.group_id = v_target.group_id and b.settled_at is not null
  ),
  wagered as (
    select coalesce(sum(b.amount), 0)::bigint as total
    from bets b
    join markets mk on mk.id = b.market_id
    where b.user_id = v_target.user_id and mk.group_id = v_target.group_id
  ),
  best as (
    select (payout::numeric / amount) as multiple, title
    from settled
    where payout is not null and payout > amount
    order by (payout::numeric / amount) desc
    limit 1
  ),
  accuracy as (
    select
      count(*) as total,
      count(*) filter (
        where (option_id is not null and option_id = outcome_option_id)
           or (option_id is null and outcome is not null and side::text = outcome::text)
      ) as correct
    from resolved_bets
  )
  select
    v_target.id,
    v_target.group_id,
    v_target.user_id,
    v_target.nickname,
    v_target.balance,
    v_target.joined_at,
    (v_target.balance - coalesce((select sum(l.amount) from ledger l where l.membership_id = p_membership_id and l.reason = 'seed'), 0))::bigint,
    case when v_is_pruned_pipeline_group then null
         when (select total from accuracy) > 0 then round(100.0 * (select correct from accuracy) / (select total from accuracy))::int
         else null end,
    case when v_is_pruned_pipeline_group then null else (select count(distinct market_id) from settled)::int end,
    case when v_is_pruned_pipeline_group then null else (select total from wagered) end,
    case when v_is_pruned_pipeline_group then null else (select multiple from best) end,
    case when v_is_pruned_pipeline_group then null else (select title from best) end;
end;
$$;

revoke execute on function get_member_stats(uuid) from public;
grant execute on function get_member_stats(uuid) to authenticated;

-- list_pipeline_health(): identical shape to 20260906102000's version, minus the two weather rows
-- from the sweeps VALUES list.
create or replace function list_pipeline_health()
returns table (
  pipeline text,
  job text,
  last_run_at timestamptz,
  last_run_succeeded int,
  last_run_failed int,
  open_failure_count bigint,
  last_failure_at timestamptz,
  last_failure_message text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not is_platform_admin() then
    raise exception 'forbidden: admin only';
  end if;

  return query
  with sweeps (pipeline, job, sweep_name) as (
    values ('sports', 'weekly_prepare', 'sports_weekly_prepare'),
           ('sports', 'weekly_publish', 'sports_weekly_publish'),
           ('sports', 'resolve', 'sports_market_resolve')
  ),
  latest_run as (
    select distinct on (pr.pipeline, pr.job) pr.pipeline, pr.job, pr.ran_at, pr.succeeded, pr.failed
    from pipeline_runs pr
    order by pr.pipeline, pr.job, pr.ran_at desc
  ),
  failure_agg as (
    select sf.sweep, count(*) as cnt, max(sf.last_failed_at) as last_failed_at,
           (array_agg(sf.error_message order by sf.last_failed_at desc))[1] as last_message
    from sweep_failures sf
    group by sf.sweep
  )
  select s.pipeline, s.job, lr.ran_at, lr.succeeded, lr.failed,
         coalesce(fa.cnt, 0), fa.last_failed_at, fa.last_message
  from sweeps s
  left join latest_run lr on lr.pipeline = s.pipeline and lr.job = s.job
  left join failure_agg fa on fa.sweep = s.sweep_name
  order by s.pipeline, s.job;
end;
$$;

revoke execute on function list_pipeline_health() from public;
grant execute on function list_pipeline_health() to authenticated;

-- expire_stale(): identical to 20260901100000's version, minus the Weather-named-group carve-out
-- in the market-close sweep that skipped emitting market_closed for it. That carve-out only ever
-- existed because Weather could resolve within minutes of its own close, making the push pure
-- noise; with Weather gone, every closed system market emits the push again, same as NFL/CFB
-- always did. The join to groups (only ever needed to read that group name) is dropped too.
create or replace function expire_stale()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  rec record;
  rec2 record;
  v_context text;
begin
  for rec in
    select id from markets
    where status = 'pending_sponsor'
      and (created_at < now() - interval '24 hours' or closes_at <= now())
    for update skip locked
  loop
    begin
      update markets set status = 'voided', outcome = 'void', resolved_at = now()
      where id = rec.id;
    exception when others then
      get stacked diagnostics v_context = pg_exception_context;
      perform _record_sweep_failure('sponsor_expiry', rec.id, sqlstate, sqlerrm, v_context);
    end;
  end loop;

  for rec in
    select m.id, m.group_id, m.is_system_market
    from markets m
    where m.status = 'open' and m.closes_at <= now()
    for update of m skip locked
  loop
    begin
      if rec.is_system_market or exists (select 1 from bets where market_id = rec.id) then
        update markets set status = 'closed', closed_at = now() where id = rec.id;
        perform _emit_notification_event('market_closed', rec.group_id, rec.id);
      else
        perform _void_market(rec.id);
      end if;
    exception when others then
      get stacked diagnostics v_context = pg_exception_context;
      perform _record_sweep_failure('market_close', rec.id, sqlstate, sqlerrm, v_context);
    end;
  end loop;

  for rec in
    select id from markets
    where is_system_market and status = 'closed' and closed_at <= now() - interval '3 days'
    for update skip locked
  loop
    begin
      perform _void_market(rec.id);
    exception when others then
      get stacked diagnostics v_context = pg_exception_context;
      perform _record_sweep_failure('system_market_stuck_closed', rec.id, sqlstate, sqlerrm, v_context);
    end;
  end loop;

  for rec in
    select m.id
    from markets m
    join resolution_proposals rp on rp.market_id = m.id
    join group_settings gs on gs.group_id = m.group_id
    where m.status = 'proposed' and rp.proposed_at + (gs.resolution_window_hours * interval '1 hour') <= now()
  loop
    begin
      perform finalize_market(rec.id);
    exception when others then
      get stacked diagnostics v_context = pg_exception_context;
      perform _record_sweep_failure('finalize_proposed', rec.id, sqlstate, sqlerrm, v_context);
    end;
  end loop;

  for rec in
    select m.id
    from markets m
    join challenges c on c.market_id = m.id
    join group_settings gs on gs.group_id = m.group_id
    where m.status = 'disputed' and c.created_at + (gs.resolution_window_hours * interval '1 hour') <= now()
  loop
    begin
      perform finalize_market(rec.id);
    exception when others then
      get stacked diagnostics v_context = pg_exception_context;
      perform _record_sweep_failure('finalize_disputed', rec.id, sqlstate, sqlerrm, v_context);
    end;
  end loop;

  -- Wind-down hard cap: force-void anything still proposed/disputed once a
  -- winding_down season's grace window has elapsed, then archive it. Most
  -- winding-down seasons never reach here at all - finalize_market()'s tail
  -- hook already archives the moment the last in-flight market clears
  -- naturally (via the two loops just above, or a direct owner/voter call).
  for rec in
    select m.id
    from seasons s
    join markets m on m.season_id = s.id
    where s.status = 'winding_down' and s.wind_down_deadline <= now()
      and m.status in ('proposed', 'disputed')
    for update of m skip locked
  loop
    begin
      perform _void_market(rec.id);
    exception when others then
      get stacked diagnostics v_context = pg_exception_context;
      perform _record_sweep_failure('wind_down_void', rec.id, sqlstate, sqlerrm, v_context);
    end;
  end loop;

  for rec in
    select id from seasons where status = 'winding_down' and wind_down_deadline <= now()
  loop
    begin
      perform _maybe_archive_winding_down_season(rec.id);
    exception when others then
      get stacked diagnostics v_context = pg_exception_context;
      perform _record_sweep_failure('wind_down_archive', rec.id, sqlstate, sqlerrm, v_context);
    end;
  end loop;

  -- Timed season auto-end. Calls the internal _end_season() rather than
  -- end_season(), which gates on auth.uid() and therefore always raised when
  -- called from cron - see 20260813170000. NULL actor is the correct
  -- attribution here: nobody ended this season, its date arrived.
  for rec in
    select group_id from seasons where status = 'active' and ends_at is not null and ends_at <= now()
  loop
    begin
      perform _end_season(rec.group_id, null::uuid);
    exception when others then
      get stacked diagnostics v_context = pg_exception_context;
      perform _record_sweep_failure('season_auto_end', rec.group_id, sqlstate, sqlerrm, v_context);
    end;
  end loop;

  -- Wrapped per group rather than per market: voiding the group's leftover
  -- markets, scheduling the deletion and emitting the notice are one decision
  -- about one group and must not be able to half-happen.
  for rec in
    select s.group_id
    from seasons s
    join groups g on g.id = s.group_id
    where s.status = 'intermission'
      and s.started_at <= now() - interval '30 days'
      and g.deletion_scheduled_at is null
  loop
    begin
      for rec2 in
        select id from markets
        where group_id = rec.group_id and status not in ('resolved', 'voided')
        for update
      loop
        -- Defensive: intermission means no active season, so nothing new
        -- could've been created since the group entered it - this should
        -- already be an empty set every time.
        perform _void_market(rec2.id);
      end loop;

      -- Pre-stamps both reminder columns so the two general-reminder loops below
      -- never pick this group up: this flow keeps its original single 5-day
      -- notice, not a second, differently-timed reminder on top of it.
      update groups
      set deletion_scheduled_at = now() + interval '5 days',
          deletion_reminder_7d_sent_at = now(),
          deletion_reminder_1d_sent_at = now()
      where id = rec.group_id;
      perform _emit_notification_event('group_deletion_scheduled_inactivity', rec.group_id, null, null, null);
    exception when others then
      get stacked diagnostics v_context = pg_exception_context;
      perform _record_sweep_failure('intermission_deletion', rec.group_id, sqlstate, sqlerrm, v_context);
    end;
  end loop;

  -- General inactivity sweep: unlike the intermission-specific one above (which
  -- only ever applies to a seasons-enabled group sitting between seasons), this
  -- covers every group regardless of whether seasons are even turned on.
  -- "Inactive" means no market created and no bet placed anywhere in the group for
  -- 90 days. A group with any market that isn't resolved/voided is left alone
  -- outright rather than force-voided here - a quiet-but-not-empty group can
  -- easily have one real market with real stakes still open (unlike the
  -- intermission sweep above, whose defensive void is only ever expected to find
  -- an empty set), and 90 days of no *new* activity is not the same claim as
  -- "nothing here matters."
  for rec in
    select g.id
    from groups g
    left join (
      select group_id, max(created_at) as last_created from markets group by group_id
    ) lm on lm.group_id = g.id
    left join (
      select m.group_id, max(b.created_at) as last_bet
      from bets b
      join markets m on m.id = b.market_id
      group by m.group_id
    ) lb on lb.group_id = g.id
    where g.deletion_scheduled_at is null
      and not exists (
        select 1 from markets m2 where m2.group_id = g.id and m2.status not in ('resolved', 'voided')
      )
      and greatest(g.created_at, coalesce(lm.last_created, g.created_at), coalesce(lb.last_bet, g.created_at))
        <= now() - interval '90 days'
  loop
    begin
      update groups set deletion_scheduled_at = now() + interval '14 days' where id = rec.id;
      perform _emit_notification_event('group_deletion_notice_14d', rec.id, null, null, null);
    exception when others then
      get stacked diagnostics v_context = pg_exception_context;
      perform _record_sweep_failure('general_inactivity_deletion', rec.id, sqlstate, sqlerrm, v_context);
    end;
  end loop;

  -- The two follow-up reminders. Gated purely on the stamp columns being unset
  -- rather than on which sweep did the scheduling - the intermission sweep above
  -- pre-stamps both the moment it schedules a deletion, so in practice these two
  -- loops only ever pick up a deletion scheduled by the 90-day sweep just above,
  -- whose 14-day grace is the only one long enough to still have 7 or 1 days left
  -- to warn about.
  for rec in
    select id from groups
    where deletion_scheduled_at is not null
      and deletion_reminder_7d_sent_at is null
      and deletion_scheduled_at - now() <= interval '7 days'
  loop
    begin
      update groups set deletion_reminder_7d_sent_at = now() where id = rec.id;
      perform _emit_notification_event('group_deletion_notice_7d', rec.id, null, null, null);
    exception when others then
      get stacked diagnostics v_context = pg_exception_context;
      perform _record_sweep_failure('deletion_reminder_7d', rec.id, sqlstate, sqlerrm, v_context);
    end;
  end loop;

  for rec in
    select id from groups
    where deletion_scheduled_at is not null
      and deletion_reminder_1d_sent_at is null
      and deletion_scheduled_at - now() <= interval '1 day'
  loop
    begin
      update groups set deletion_reminder_1d_sent_at = now() where id = rec.id;
      perform _emit_notification_event('group_deletion_notice_1d', rec.id, null, null, null);
    exception when others then
      get stacked diagnostics v_context = pg_exception_context;
      perform _record_sweep_failure('deletion_reminder_1d', rec.id, sqlstate, sqlerrm, v_context);
    end;
  end loop;

  for rec in
    select id, name from groups
    where deletion_scheduled_at is not null and deletion_scheduled_at <= now()
  loop
    begin
      insert into lifecycle_events (event_type, user_id, group_id, metadata)
      values ('group_delete', null, rec.id, jsonb_build_object('group_id', rec.id, 'group_name', rec.name, 'reason', 'grace_period_expired'));

      delete from groups where id = rec.id;
    exception when others then
      get stacked diagnostics v_context = pg_exception_context;
      perform _record_sweep_failure('group_delete', rec.id, sqlstate, sqlerrm, v_context);
    end;
  end loop;
end;
$$;

revoke execute on function expire_stale() from public;
revoke execute on function expire_stale() from authenticated;
grant execute on function expire_stale() to service_role;
