-- sports-resolve-markets polling every 30 minutes across 3 leagues burns 144 Odds API /scores
-- requests/day. That single-handedly exhausted the account's monthly usage credits within about
-- a day of the pipeline going live (OUT_OF_USAGE_CREDITS), which /events (the create side) never
-- hits since that endpoint is free. Dropping to every 6 hours brings it to 12 requests/day
-- (~360/month), leaving headroom under a typical free-tier 500/month budget. cron.schedule() with
-- an existing job name reschedules it in place, same as 20260712100000_expire_stale_every_minute.sql.
do $$
begin
  perform cron.schedule(
    'barbets-sports-resolve-markets',
    '0 */6 * * *',
    $cron$select net.http_post(
      url := 'https://ispwzspstiulzwuskqpu.supabase.co/functions/v1/sports-resolve-markets',
      headers := '{"Content-Type": "application/json"}'::jsonb
    );$cron$
  );
exception when others then
  raise notice 'pg_cron rescheduling for sports-resolve-markets skipped (%). Enable pg_cron in the Supabase dashboard, then run: select cron.schedule(''barbets-sports-resolve-markets'', ''0 */6 * * *'', $cron$select net.http_post(url := ''https://ispwzspstiulzwuskqpu.supabase.co/functions/v1/sports-resolve-markets'', headers := ''{"Content-Type": "application/json"}''::jsonb);$cron$);', sqlerrm;
end;
$$;
