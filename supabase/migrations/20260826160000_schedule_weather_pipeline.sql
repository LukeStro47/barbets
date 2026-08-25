-- Schedules the two weather Edge Functions via pg_cron + pg_net, same pattern and same guarded
-- exception block as 20260707194059_schedule_send_push.sql (pg_cron/pg_net availability varies by
-- project/plan, and per ARCHITECTURE.md's staging caveats both extensions stay disabled there on
-- purpose -- every test drives the pipelines by invoking the functions directly).
--
-- weather-create-markets once a day (a forecast doesn't move mid-morning); weather-resolve-markets
-- every 30 minutes, since a market's real "day is over" moment is inherently approximate and this
-- just keeps retrying until the station's latest observation clears the line -- each run is a
-- no-op once nothing is left with a past closes_at, so a shorter interval costs nothing but an
-- empty query.
do $$
begin
  execute 'create extension if not exists pg_net';

  perform cron.schedule(
    'barbets-weather-create-markets',
    '0 12 * * *',
    $cron$select net.http_post(
      url := 'https://ispwzspstiulzwuskqpu.supabase.co/functions/v1/weather-create-markets',
      headers := '{"Content-Type": "application/json"}'::jsonb
    );$cron$
  );

  perform cron.schedule(
    'barbets-weather-resolve-markets',
    '*/30 * * * *',
    $cron$select net.http_post(
      url := 'https://ispwzspstiulzwuskqpu.supabase.co/functions/v1/weather-resolve-markets',
      headers := '{"Content-Type": "application/json"}'::jsonb
    );$cron$
  );
exception when others then
  raise notice 'pg_cron/pg_net scheduling for the weather pipeline skipped (%). Enable both extensions in the Supabase dashboard, then run the cron.schedule(...) calls from this migration manually.', sqlerrm;
end;
$$;
