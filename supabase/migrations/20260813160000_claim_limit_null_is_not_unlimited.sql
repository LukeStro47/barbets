-- `p_limit int default 200` reads like a guard on how much of the queue one
-- send-push run takes. Through PostgREST it is not one, for two reasons that
-- only bite together:
--
--   1. PostgREST never relies on a function's default. The query it builds
--      passes every argument by name, `claim_notification_events(p_limit :=
--      pgrst_body."p_limit")`, filling that value from the request body via
--      json_to_record. A body that omits the key (or sends it as JSON null)
--      therefore passes NULL, not 200.
--   2. `limit null` in Postgres means no limit at all, exactly as if the clause
--      had been left out.
--
-- So the one call shape that looks safest, "just let it default", is the one
-- that claims the entire backlog in a single statement. That matters because
-- claiming is at-most-once (see the note in 20260813120000): a run that takes
-- the whole queue and then dies partway through sending drops every event it
-- claimed, which is precisely the blast radius the batch size exists to keep
-- small. The default is worth keeping, it just has to be applied where it
-- actually applies.
--
-- Same argument types, so CREATE OR REPLACE is the whole change: no second
-- overload is created and none needs dropping.
create or replace function claim_notification_events(p_limit int default 200)
returns setof notification_events
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with claimed as (
    update notification_events ne
    set processed_at = now()
    where ne.id in (
      select id
      from notification_events
      where processed_at is null
      order by created_at
      limit coalesce(p_limit, 200)
      for update skip locked
    )
    returning ne.*
  )
  select * from claimed;
end;
$$;
