-- 20260828170000's loop somehow left this one function's anon grant untouched (confirmed via
-- _debug_fn_overloads: a single, unambiguous overload, still anon-executable after that migration
-- ran). Explicit, targeted revoke rather than re-running the loop, to isolate whether this sticks.
revoke execute on function _compute_season_ends_at(season_length, timestamp with time zone, timestamp with time zone) from anon;
