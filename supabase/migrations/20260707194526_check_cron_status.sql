-- Diagnostic only: reports whether the two best-effort cron schedules
-- (expire_stale from Phase 2, send-push from Phase 6) actually registered,
-- since both are wrapped in exception handlers that silently degrade if
-- pg_cron/pg_net aren't enabled on this project.
do $$
declare
  v_count int;
  v_row record;
begin
  select count(*) into v_count from cron.job where jobname in ('barbets-expire-stale', 'barbets-send-push');
  raise notice 'cron jobs registered: % (expect 2)', v_count;
  for v_row in select jobname, schedule, active from cron.job where jobname like 'barbets-%' loop
    raise notice '  % — schedule=% active=%', v_row.jobname, v_row.schedule, v_row.active;
  end loop;
exception when others then
  raise notice 'could not check cron.job (%) — pg_cron likely not enabled', sqlerrm;
end;
$$;
