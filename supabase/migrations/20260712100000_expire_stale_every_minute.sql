-- Tightens expire_stale()'s cron interval from every 5 minutes to every
-- minute, matching send-push's existing cadence (proof this Supabase plan
-- already handles 1-minute pg_cron scheduling fine). cron.schedule() with an
-- existing job name reschedules it in place rather than erroring or
-- duplicating. Same best-effort wrapping as the original scheduling
-- migration, in case pg_cron isn't enabled on some environment.
do $$
begin
  perform cron.schedule('barbets-expire-stale', '* * * * *', 'select expire_stale();');
exception when others then
  raise notice 'pg_cron rescheduling skipped (%). Enable pg_cron in the Supabase dashboard, then run: select cron.schedule(''barbets-expire-stale'', ''* * * * *'', ''select expire_stale();'');', sqlerrm;
end;
$$;
