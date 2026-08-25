-- The Sports/Weather pipelines record per-row failures directly from their Edge Functions (the
-- unit of work is "one HTTP-fetched game/city," not a SQL sweep loop, so there's no enclosing
-- SECURITY DEFINER function to call this from internally the way expire_stale() does). Needs an
-- explicit service_role grant -- previously only reachable from inside another SECURITY DEFINER
-- function's implicit owner privileges.
grant execute on function _record_sweep_failure(text, uuid, text, text, text) to service_role;
