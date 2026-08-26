-- pipeline_runs: one row per Sports/Weather Edge Function invocation, logging how many rows it
-- touched successfully vs. how many it recorded to sweep_failures. sweep_failures alone can say
-- "these particular rows are stuck failing" but not "is the pipeline actually running on
-- schedule" -- a pipeline that silently stopped being invoked at all (cron misconfigured, the
-- Edge Function itself failing to deploy) leaves sweep_failures completely empty, which reads as
-- healthy. This table is what lets the admin console tell "quiet because nothing's wrong" apart
-- from "quiet because it stopped running."
--
-- Same "internal diagnostic, service_role only, RLS on with zero policies" shape as
-- sweep_failures. Append-only and unbounded on purpose for now: at one row per job per
-- invocation (4 jobs, the least frequent every 12h) this accumulates a few thousand rows a year,
-- nowhere near worth a retention sweep yet.
create table pipeline_runs (
  id bigint generated always as identity primary key,
  pipeline text not null check (pipeline in ('sports', 'weather')),
  job text not null check (job in ('create', 'resolve')),
  ran_at timestamptz not null default now(),
  succeeded int not null,
  failed int not null
);

create index idx_pipeline_runs_pipeline_job_ran_at on pipeline_runs (pipeline, job, ran_at desc);

alter table pipeline_runs enable row level security;

-- Every mutation goes through a SECURITY DEFINER function, same rule as the rest of this
-- codebase -- no direct admin.from('pipeline_runs').insert() from the Edge Functions, matching
-- how they already go through _record_sweep_failure() rather than writing sweep_failures
-- directly.
create function _record_pipeline_run(p_pipeline text, p_job text, p_succeeded int, p_failed int)
returns void
language sql
security definer
set search_path = public
as $$
  insert into pipeline_runs (pipeline, job, succeeded, failed) values (p_pipeline, p_job, p_succeeded, p_failed);
$$;

revoke execute on function _record_pipeline_run(text, text, int, int) from public;
revoke execute on function _record_pipeline_run(text, text, int, int) from authenticated;
grant execute on function _record_pipeline_run(text, text, int, int) to service_role;

-- list_pipeline_health(): the admin console's one call for "is each pipeline healthy." One row
-- per (pipeline, job) -- 4 total -- with the most recent run's counts and a rollup of whatever's
-- currently sitting in sweep_failures for that job's sweep name. sweep names
-- (sports_market_create etc.) are hardcoded here rather than read from the Edge Functions since
-- that's the one place they're defined; keep this VALUES list in sync if a sweep is ever renamed.
create function list_pipeline_health()
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
    values ('sports', 'create', 'sports_market_create'),
           ('sports', 'resolve', 'sports_market_resolve'),
           ('weather', 'create', 'weather_market_create'),
           ('weather', 'resolve', 'weather_market_resolve')
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
