-- _compute_season_ends_at is the one function in this codebase that never followed the
-- revoke-from-public/grant-to-authenticated convention at all (20260719144000 created it with no
-- grant lines whatsoever) -- harmless in practice, since it's `immutable`, touches no table, and
-- reads no auth.uid(), just pure date math on its explicit arguments, but revoking from `anon`
-- alone (20260828190000) couldn't fix it: PUBLIC's own default create-time grant applies to every
-- role including anon, so anon inherits execute through PUBLIC regardless of any anon-specific
-- revoke. Locked down here for consistency with every other function's stated posture.
revoke execute on function _compute_season_ends_at(season_length, timestamp with time zone, timestamp with time zone) from public;
grant execute on function _compute_season_ends_at(season_length, timestamp with time zone, timestamp with time zone) to authenticated;

-- Diagnostic helpers from the anon-grant audit (20260828160000, 20260828180000), no longer needed
-- now that the audit is clean.
drop function if exists _debug_anon_grants();
drop function if exists _debug_fn_overloads(text);
