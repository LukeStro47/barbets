-- The previous migration's CREATE OR REPLACE calls each added a new trailing
-- parameter (p_options/p_option_subjects, p_option_id) to create_market,
-- place_bet, propose_resolution, and cast_vote. That does NOT replace the
-- old signature in Postgres — a function's identity is its (name, argument
-- *types*) signature, and a longer argument list is a different signature,
-- full stop, regardless of the new parameters having defaults. So the old,
-- shorter-signature versions of all four are still sitting in the catalog
-- as separate overloads, and PostgREST can no longer pick a candidate for
-- an RPC call that only supplies the original arguments (the exact ambiguity
-- the cast_vote bet_side->market_outcome widening already ran into once).
-- Drop the stale overloads so only the new (already-current) definitions
-- remain.
drop function if exists create_market(uuid, text, text, market_type, timestamptz, numeric, uuid[]);
drop function if exists place_bet(uuid, bet_side, int);
drop function if exists propose_resolution(uuid, market_outcome, text, numeric);
drop function if exists cast_vote(uuid, market_outcome);
