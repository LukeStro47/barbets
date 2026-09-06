-- Retires the old sports-create-markets cron entry (that Edge Function no longer exists -- see
-- sports-weekly-prepare/sports-weekly-publish, which replace it) and schedules the two new weekly
-- jobs in its place. sports-resolve-markets keeps its existing 'barbets-sports-resolve-markets'
-- schedule untouched (still every 6 hours, from 20260830100000) -- same function name, same route,
-- nothing to reschedule.
--
-- Own do-block per statement, same guarded pattern as every other pg_cron migration in this
-- project: staging disables pg_cron/pg_net on purpose (tests invoke functions directly instead),
-- and cron.unschedule() raises if the named job doesn't exist, which would otherwise fail this
-- whole migration on an environment where it was never scheduled to begin with.
do $$
begin
  perform cron.unschedule('barbets-sports-create-markets');
exception when others then
  raise notice 'pg_cron unschedule of barbets-sports-create-markets skipped (%). If pg_cron is enabled and the job still exists, run: select cron.unschedule(''barbets-sports-create-markets'');', sqlerrm;
end;
$$;

do $$
begin
  execute 'create extension if not exists pg_net';

  -- Monday morning: fetch this week's NFL/CFB candidates and ping an admin to pick.
  perform cron.schedule(
    'barbets-sports-weekly-prepare',
    '0 13 * * 1',
    $cron$select net.http_post(
      url := 'https://ispwzspstiulzwuskqpu.supabase.co/functions/v1/sports-weekly-prepare',
      headers := '{"Content-Type": "application/json"}'::jsonb
    );$cron$
  );

  -- Tuesday morning: turn each league's pick (or, absent one, the latest-kickoff fallback) into
  -- that week's actual market.
  perform cron.schedule(
    'barbets-sports-weekly-publish',
    '0 13 * * 2',
    $cron$select net.http_post(
      url := 'https://ispwzspstiulzwuskqpu.supabase.co/functions/v1/sports-weekly-publish',
      headers := '{"Content-Type": "application/json"}'::jsonb
    );$cron$
  );
exception when others then
  raise notice 'pg_cron/pg_net scheduling for the sports weekly pipeline skipped (%). Enable both extensions in the Supabase dashboard, then run the cron.schedule(...) calls from this migration manually.', sqlerrm;
end;
$$;
