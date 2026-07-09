-- Schedules the send-push Edge Function every minute via pg_cron + pg_net
-- (pg_cron only runs SQL; calling an HTTP endpoint from it needs pg_net's
-- net.http_post). Same best-effort wrapping as expire_stale()'s scheduling
-- migration — pg_cron/pg_net availability varies by project/plan, so this
-- must not fail the whole migration if either isn't enabled yet.
--
-- The function is deployed with --no-verify-jwt (it takes no meaningful
-- input and only ever processes the internal notification_events queue),
-- so no auth header/secret needs to live in this migration.
do $$
begin
  execute 'create extension if not exists pg_net';
  perform cron.schedule(
    'barbets-send-push',
    '* * * * *',
    $cron$select net.http_post(
      url := 'https://ispwzspstiulzwuskqpu.supabase.co/functions/v1/send-push',
      headers := '{"Content-Type": "application/json"}'::jsonb
    );$cron$
  );
exception when others then
  raise notice 'pg_cron/pg_net scheduling for send-push skipped (%). Enable both extensions in the Supabase dashboard, then run the cron.schedule(...) call from this migration manually (see the README).', sqlerrm;
end;
$$;
