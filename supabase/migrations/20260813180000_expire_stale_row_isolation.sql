-- expire_stale() is one transaction covering every group on the platform, and
-- until now it had no error handling at all. pg_cron runs `select
-- expire_stale();` every minute, which is a single statement and therefore a
-- single transaction, and PL/pgSQL cannot commit partway through one. So all
-- nine sweeps, across every group, were all-or-nothing: one market raising
-- anywhere in the body rolled back every market closed, every season ended,
-- every group deleted and every notification queued earlier in that same run.
--
-- The part that turns a bug into an outage is that it repeats. Nothing
-- committed, so the next tick re-runs the same queries, finds the same bad row
-- and dies in the same place. One poisoned row stops the entire platform's
-- background maintenance indefinitely: markets never close at their deadline,
-- proposals never auto-finalize, scheduled group deletions never happen. And
-- it does it in silence, since this path has no Slack reporting the way
-- send-push does and cron.job_run_details is not something anyone reads.
-- 20260813170000 documents a live instance of exactly this.
--
-- The fix is per-iteration `begin ... exception ... end` blocks. In PL/pgSQL
-- such a block is an implicit savepoint, so a raise inside one rolls back only
-- that iteration's work and the loop carries on with the next row. That buys
-- row-level isolation without needing to split the transaction, which is the
-- part PL/pgSQL simply cannot do here.
--
-- Four things about the shape are deliberate:
--
--   * The state change and its notification stay inside the same block. That
--     pairing is the one thing the old all-or-nothing behaviour got right: a
--     close that rolls back must not leave a market_closed push queued behind
--     it. Same block, same savepoint, still true.
--   * The failure record survives the rollback. _record_sweep_failure() writes
--     in the outer transaction and only the inner savepoint was rolled back,
--     so the evidence persists even though the market's own changes did not.
--   * It records by upsert with an attempt counter, not a plain insert. A
--     permanently poisoned row is retried every minute forever, and one row
--     per minute per failure would bury the signal in its own noise.
--   * `when others` is safe to use bare here. Postgres deliberately excludes
--     QUERY_CANCELED and ASSERT_FAILURE from OTHERS, so a statement timeout or
--     an admin cancelling the run still propagates instead of being quietly
--     swallowed and retried.
--
-- The cost worth knowing: entering a begin/exception block allocates a
-- subtransaction, and past 64 live subtransactions in one transaction Postgres
-- overflows its per-backend cache and every concurrent snapshot check gets
-- slower. At this sweep's volume (a handful of rows a minute) that is far
-- away, but it is the reason the blocks wrap whole loop iterations rather than
-- individual statements, and the reason to revisit this if a single run ever
-- starts processing hundreds of rows.
--
-- The row-locking loops also gain `skip locked`. A market a member is actively
-- acting on is now skipped this minute and picked up the next, instead of the
-- platform-wide sweep queueing behind one person's open transaction. Every
-- lock this function takes is held until the whole run commits, so blocking on
-- one row delayed all nine sweeps for everybody.

create table sweep_failures (
  -- Which loop in expire_stale() failed, and on what. subject_id is a market,
  -- season or group id depending on the sweep, so it deliberately carries no
  -- foreign key: there is no single table to point at, and a cascade would
  -- delete the evidence at exactly the moment it is most worth having.
  sweep text not null,
  subject_id uuid not null,
  attempts int not null default 1,
  first_failed_at timestamptz not null default now(),
  last_failed_at timestamptz not null default now(),
  error_code text not null,
  error_message text not null,
  error_context text,
  -- Set once send-push has surfaced this failure to Slack, so a row that keeps
  -- failing every minute produces one card rather than 1,440 a day. attempts
  -- is what tells you it is still happening.
  reported_at timestamptz,
  primary key (sweep, subject_id)
);

create index idx_sweep_failures_unreported on sweep_failures (first_failed_at) where reported_at is null;

alter table sweep_failures enable row level security;
-- No policies at all, same as notification_events: an internal diagnostic
-- table that only service_role (which bypasses RLS entirely) ever touches.

-- Called from inside an exception handler, so it runs in the outer transaction
-- and its write outlives the rolled-back savepoint. SQLSTATE/SQLERRM are passed
-- in rather than read here, since the special variables only carry the current
-- error inside the handler that caught it.
create or replace function _record_sweep_failure(
  p_sweep text,
  p_subject_id uuid,
  p_sqlstate text,
  p_message text,
  p_context text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into sweep_failures (sweep, subject_id, error_code, error_message, error_context)
  values (p_sweep, p_subject_id, p_sqlstate, p_message, p_context)
  on conflict (sweep, subject_id) do update
  set attempts = sweep_failures.attempts + 1,
      last_failed_at = now(),
      error_code = excluded.error_code,
      error_message = excluded.error_message,
      error_context = excluded.error_context;

  raise warning 'expire_stale sweep % failed on %: % (%)', p_sweep, p_subject_id, p_message, p_sqlstate;
end;
$$;

revoke execute on function _record_sweep_failure(text, uuid, text, text, text) from public;
revoke execute on function _record_sweep_failure(text, uuid, text, text, text) from authenticated;

-- Hands send-push a slice of not-yet-reported failures, marking and returning
-- in one statement for the same reason claim_notification_events does
-- (20260813120000): two overlapping runs must not both post the same card.
-- The limit is coalesced in the body rather than left to the parameter
-- default: PostgREST never uses a function's default, it passes every argument
-- by name from the request body, so an omitted key arrives as NULL - and
-- `limit null` in Postgres is no limit at all.
create or replace function claim_unreported_sweep_failures(p_limit int default 10)
returns setof sweep_failures
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with claimed as (
    update sweep_failures sf
    set reported_at = now()
    -- Inner table aliased and both columns qualified: the row-wise IN is
    -- already the least familiar thing here, and an unqualified `sweep` on both
    -- sides of it is one rename away from silently binding to the outer row.
    where (sf.sweep, sf.subject_id) in (
      select pick.sweep, pick.subject_id
      from sweep_failures pick
      where pick.reported_at is null
      order by pick.first_failed_at
      limit coalesce(p_limit, 10)
      for update skip locked
    )
    returning sf.*
  )
  select * from claimed;
end;
$$;

revoke execute on function claim_unreported_sweep_failures(int) from public;
revoke execute on function claim_unreported_sweep_failures(int) from authenticated;
grant execute on function claim_unreported_sweep_failures(int) to service_role;

-- Read-only diagnostic, same service_role-only reasoning as
-- get_cron_job_status(): "is the sweep quietly failing on something, and for
-- how long" without needing a psql session.
create or replace function get_sweep_failures()
returns setof sweep_failures
language sql
stable
security definer
set search_path = public
as $$
  select * from sweep_failures order by last_failed_at desc;
$$;

revoke execute on function get_sweep_failures() from public;
revoke execute on function get_sweep_failures() from authenticated;
grant execute on function get_sweep_failures() to service_role;

-- Retention moves out of expire_stale() and onto its own daily schedule.
-- 20260714100000 deliberately folded it into the existing per-minute cron
-- entry rather than registering a second one, on the grounds that one more
-- schedule is one more thing to maintain. That was reasonable and is being
-- reversed on purpose, for two reasons it could not have known:
--
--   1. It made a 30-day retention delete hostage to a market-closing bug. The
--      per-row isolation above covers raises inside the loops, but anything
--      that escapes still rolls back a statement that has nothing to do with
--      any of them.
--   2. notification_events has no index on processed_at (the only index is the
--      partial one on unprocessed rows), so this delete sequentially scanned
--      the whole table every single minute to find, almost always, nothing.
--      Running it daily makes the plain scan entirely reasonable, which is why
--      no index is being added for it.
create or replace function purge_processed_notification_events()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from notification_events
  where processed_at is not null and processed_at < now() - interval '30 days';

  -- Sweep failures age out on the same schedule. A row whose underlying cause
  -- was fixed (or was transient) stops being touched, and a month of silence
  -- is a fair definition of resolved. Anything still genuinely failing has a
  -- last_failed_at from this minute and is never eligible.
  delete from sweep_failures
  where last_failed_at < now() - interval '30 days';
end;
$$;

revoke execute on function purge_processed_notification_events() from public;
revoke execute on function purge_processed_notification_events() from authenticated;
grant execute on function purge_processed_notification_events() to service_role;

-- Same best-effort wrapping every other scheduling migration in this project
-- uses: pg_cron availability varies by project and plan, and this must not
-- fail the migration if it is not enabled.
do $$
begin
  perform cron.schedule('barbets-purge-notifications', '17 3 * * *', 'select purge_processed_notification_events();');
exception when others then
  raise notice 'pg_cron scheduling for purge_processed_notification_events skipped (%). Enable pg_cron in the Supabase dashboard, then run: select cron.schedule(''barbets-purge-notifications'', ''17 3 * * *'', ''select purge_processed_notification_events();'');', sqlerrm;
end;
$$;

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
    select id, group_id from markets
    where status = 'open' and closes_at <= now()
    for update skip locked
  loop
    begin
      if exists (select 1 from bets where market_id = rec.id) then
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
  -- winding-down seasons never reach here at all — finalize_market()'s tail
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
        -- could've been created since the group entered it — this should
        -- already be an empty set every time.
        perform _void_market(rec2.id);
      end loop;

      update groups set deletion_scheduled_at = now() + interval '5 days' where id = rec.group_id;
      perform _emit_notification_event('group_deletion_scheduled_inactivity', rec.group_id, null, null, null);
    exception when others then
      get stacked diagnostics v_context = pg_exception_context;
      perform _record_sweep_failure('intermission_deletion', rec.group_id, sqlstate, sqlerrm, v_context);
    end;
  end loop;

  for rec in
    select id from groups
    where deletion_scheduled_at is not null and deletion_scheduled_at <= now()
  loop
    begin
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
