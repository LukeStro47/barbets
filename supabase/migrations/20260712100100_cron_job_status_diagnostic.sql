-- Read-only diagnostic for verifying pg_cron schedules actually took effect
-- (cron.job isn't exposed via PostgREST directly). service_role only, same
-- reasoning as get_notification_recipients: bypasses RLS by nature, not
-- something a client session should ever call.
create or replace function get_cron_job_status()
returns table (jobname text, schedule text, active boolean)
language sql
stable
security definer
set search_path = public
as $$
  select jobname, schedule, active from cron.job where jobname like 'barbets-%';
$$;

revoke execute on function get_cron_job_status() from public;
revoke execute on function get_cron_job_status() from authenticated;
grant execute on function get_cron_job_status() to service_role;
