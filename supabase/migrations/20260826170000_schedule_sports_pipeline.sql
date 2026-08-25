-- Schedules the two sports Edge Functions via pg_cron + pg_net, same guarded-exception pattern as
-- 20260707194059_schedule_send_push.sql and the weather pipeline's own scheduling migration.
--
-- sports-create-markets twice a day (a 12-hour lookahead window, so twice a day keeps it from
-- ever going more than half a day without picking up newly scheduled games); sports-resolve-
-- markets every 30 minutes, same reasoning as weather -- a game's real end time is inherently
-- approximate, so it just keeps retrying on schedule until the scores endpoint reports it final.
do $$
begin
  execute 'create extension if not exists pg_net';

  perform cron.schedule(
    'barbets-sports-create-markets',
    '0 */12 * * *',
    $cron$select net.http_post(
      url := 'https://ispwzspstiulzwuskqpu.supabase.co/functions/v1/sports-create-markets',
      headers := '{"Content-Type": "application/json"}'::jsonb
    );$cron$
  );

  perform cron.schedule(
    'barbets-sports-resolve-markets',
    '*/30 * * * *',
    $cron$select net.http_post(
      url := 'https://ispwzspstiulzwuskqpu.supabase.co/functions/v1/sports-resolve-markets',
      headers := '{"Content-Type": "application/json"}'::jsonb
    );$cron$
  );
exception when others then
  raise notice 'pg_cron/pg_net scheduling for the sports pipeline skipped (%). Enable both extensions in the Supabase dashboard, then run the cron.schedule(...) calls from this migration manually.', sqlerrm;
end;
$$;
