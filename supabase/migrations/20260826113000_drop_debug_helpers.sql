-- Cleanup: drop the diagnostic-only helpers added while tracking down a
-- stale-connection issue on the hosted project (unrelated to any actual bug
-- in void_market_by_owner's mod-gate logic, which was confirmed correct via
-- direct psql). Not part of the feature.
drop function if exists _debug_get_fn_def(text);
drop function if exists _debug_void_check(uuid);
