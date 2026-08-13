-- claim_notification_events: hands the send-push Edge Function a private slice
-- of the queue, so two runs can overlap without both sending the same push.
--
-- Until now send-push selected unprocessed rows and wrote processed_at only
-- after every send for that event had been attempted. That is safe exactly as
-- long as a run always finishes inside its own cron minute — the moment one
-- overruns, the next tick selects the same rows and every recipient gets the
-- notification twice. Which is why the batch limit of 50 could never be
-- raised: it was never a meaningful number, just a guess at what fits in a
-- minute when every recipient costs a database round trip plus a push, all in
-- series. Claiming first is what makes the limit safe to raise at all.
--
-- `for update skip locked` is the standard queue-claim pattern: the subselect
-- locks the rows it picks and steps over any another run already holds, so
-- concurrent callers get disjoint slices instead of queueing behind each other.
-- The claim and the mark happen in one statement, so there is no window where
-- a row is spoken for but not yet flagged.
--
-- Claim-then-send is at-most-once: if the function dies mid-batch, the events
-- it claimed are already marked processed and those pushes are simply lost.
-- That is a small step from what this pipeline already did, where a send that
-- failed for one recipient was logged and never retried (see the comment above
-- the processed_at write that used to live in send-push/index.ts). The
-- at-least-once alternative — a separate claimed_at column plus a sweep that
-- releases claims left behind by a dead run — buys crash-retry for more moving
-- parts than this queue's volume justifies today. Nothing in here moves tokens,
-- so the cost of a dropped row is one missed notification. Revisit if that
-- stops being true.
--
-- Written as a data-modifying CTE feeding a plain select rather than the more
-- obvious `return query update ... returning`: PL/pgSQL's RETURN QUERY only
-- accepts a query, and UPDATE ... RETURNING is not one, so the direct form is a
-- syntax error.
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
      limit p_limit
      for update skip locked
    )
    returning ne.*
  )
  select * from claimed;
end;
$$;

revoke execute on function claim_notification_events(int) from public;
revoke execute on function claim_notification_events(int) from authenticated;
grant execute on function claim_notification_events(int) to service_role;
