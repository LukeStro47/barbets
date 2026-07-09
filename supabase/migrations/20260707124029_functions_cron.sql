-- expire_stale: the single cron entry point covering all four timer-driven
-- transitions in the spec. Not meant for client invocation — no grant to
-- authenticated. Idempotent: every branch only touches rows that are
-- actually past their deadline, so running it early or twice in a row is a
-- no-op beyond the first pass.
create or replace function expire_stale()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  rec record;
begin
  -- 1. Unsponsored markets older than 72h auto-expire. No bets are possible
  -- yet at this stage (place_bet requires status = 'open', which only
  -- happens after sponsorship), so there's nothing to refund.
  for rec in
    select id from markets
    where status = 'pending_sponsor' and created_at < now() - interval '72 hours'
    for update
  loop
    update markets set status = 'voided', outcome = 'void', resolved_at = now()
    where id = rec.id;
  end loop;

  -- 2. Open markets past their deadline close — betting locks, implied
  -- odds become visible to non-subjects, awaiting resolution.
  update markets
  set status = 'closed'
  where status = 'open' and closes_at <= now();

  -- 3. Unchallenged proposals past the 24h challenge window auto-finalize,
  -- accepting the proposed outcome.
  for rec in
    select m.id
    from markets m
    join resolution_proposals rp on rp.market_id = m.id
    where m.status = 'proposed' and rp.proposed_at + interval '24 hours' <= now()
  loop
    perform finalize_market(rec.id);
  end loop;

  -- 4. Disputed markets past the 48h vote window get tallied and finalized
  -- (majority wins; tie or zero votes -> VOID) inside finalize_market()
  -- itself.
  for rec in
    select m.id
    from markets m
    join challenges c on c.market_id = m.id
    where m.status = 'disputed' and c.created_at + interval '48 hours' <= now()
  loop
    perform finalize_market(rec.id);
  end loop;

  -- 5. Groups running a timed (non-manual) season whose configured length
  -- has elapsed auto-end it.
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
grant execute on function expire_stale() to service_role;

-- Best-effort: schedule expire_stale() every 5 minutes via pg_cron if the
-- extension is available on this project. Some Supabase plans/projects
-- require enabling pg_cron via the dashboard (Database > Extensions) before
-- it can be used from a migration, so this is wrapped to avoid failing the
-- whole migration if that hasn't happened yet — check the notice this
-- raises; if scheduling was skipped, enable pg_cron in the dashboard and
-- re-run this block manually (see the README).
do $$
begin
  execute 'create extension if not exists pg_cron';
  perform cron.schedule('barbets-expire-stale', '*/5 * * * *', 'select expire_stale();');
exception when others then
  raise notice 'pg_cron scheduling skipped (%). Enable the pg_cron extension in the Supabase dashboard, then run: select cron.schedule(''barbets-expire-stale'', ''*/5 * * * *'', ''select expire_stale();'');', sqlerrm;
end;
$$;
