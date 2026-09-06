-- Sports drops its 'create' job (the old continuously-polling sports-create-markets) for two new
-- weekly ones -- 'weekly_prepare' (Monday, fetches candidates) and 'weekly_publish' (Tuesday,
-- turns the pick into a market) -- while keeping 'resolve' unchanged. Weather is untouched: still
-- 'create'/'resolve', just creating one market a day instead of up to six.
alter table pipeline_runs drop constraint if exists pipeline_runs_job_check;
alter table pipeline_runs add constraint pipeline_runs_job_check
  check (job in ('create', 'resolve', 'weekly_prepare', 'weekly_publish'));

-- list_pipeline_health(): identical shape to 20260828110000's version, just a different sweeps
-- VALUES list -- same return columns, so a plain CREATE OR REPLACE is correct. sports_market_create
-- (the retired sports-create-markets sweep name) is dropped in favor of the two new sweep names
-- sports-weekly-prepare/sports-weekly-publish record failures under.
create or replace function list_pipeline_health()
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
    values ('sports', 'weekly_prepare', 'sports_weekly_prepare'),
           ('sports', 'weekly_publish', 'sports_weekly_publish'),
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
