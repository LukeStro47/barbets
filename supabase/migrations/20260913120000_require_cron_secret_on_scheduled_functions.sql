-- 2026-09-13 incident: sports-weekly-prepare and sports-weekly-publish are deployed
-- --no-verify-jwt (pg_cron's net.http_post carries no Supabase auth token), which made the bare
-- Edge Function URL callable by anyone on the internet with zero authentication. An external
-- scanner probing for an open LLM API (GET/POST to /v1/models and /v1/chat/completions -- paths
-- these functions never route on, since each is a bare Deno.serve that ignores the request path
-- entirely) landed on both functions' real URLs within the same few seconds and ran their real
-- logic: cron.job_run_details shows pg_cron itself never fired outside its scheduled 13:00 UTC
-- slots that day, but the Edge Function logs show six hits at 23:36:17-23:36:42 UTC across both
-- functions. By then the current week's game was already published, so the run's own
-- nextTuesdayUtcDate(now) landed on next week's key and published that week's game three days
-- early with no admin pick -- the "duplicate" market this migration's incident is named for.
-- send-push and sports-resolve-markets share the same --no-verify-jwt exposure (confirmed: no
-- auth check of any kind existed in any of the four), just hadn't been hit yet.
--
-- The fix: each function now requires a `x-cron-secret` header matching CRON_SECRET (an Edge
-- Function secret, set via `supabase secrets set CRON_SECRET=<value>`, read with Deno.env.get the
-- same way every other Edge Function secret in this codebase is). This migration re-schedules the
-- four existing cron jobs to send that header. The secret value itself is pulled from Supabase
-- Vault (`vault.decrypted_secrets`) rather than hardcoded here, since a migration file is
-- committed to git -- see ARCHITECTURE.md for the one-time `vault.create_secret(...)` step this
-- depends on, which is run by hand against production, never checked in.
--
-- Same guarded do-block-per-statement pattern as every other pg_cron migration in this project:
-- staging disables pg_cron/pg_net on purpose, and a project where the Vault secret was never
-- created would otherwise fail this whole migration rather than just skipping cleanly.
do $$
begin
  perform cron.schedule(
    'barbets-send-push',
    '* * * * *',
    $cron$select net.http_post(
      url := 'https://ispwzspstiulzwuskqpu.supabase.co/functions/v1/send-push',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
      )
    );$cron$
  );

  perform cron.schedule(
    'barbets-sports-resolve-markets',
    '0 */6 * * *',
    $cron$select net.http_post(
      url := 'https://ispwzspstiulzwuskqpu.supabase.co/functions/v1/sports-resolve-markets',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
      )
    );$cron$
  );

  perform cron.schedule(
    'barbets-sports-weekly-prepare',
    '0 13 * * 1',
    $cron$select net.http_post(
      url := 'https://ispwzspstiulzwuskqpu.supabase.co/functions/v1/sports-weekly-prepare',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
      )
    );$cron$
  );

  perform cron.schedule(
    'barbets-sports-weekly-publish',
    '0 13 * * 2',
    $cron$select net.http_post(
      url := 'https://ispwzspstiulzwuskqpu.supabase.co/functions/v1/sports-weekly-publish',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
      )
    );$cron$
  );
exception when others then
  raise notice 'pg_cron rescheduling with the cron secret header skipped (%). If pg_cron/pg_net are enabled and the ''cron_secret'' Vault entry exists, run this migration''s cron.schedule(...) calls manually.', sqlerrm;
end;
$$;
