-- The timezone migration added p_timezone as a new trailing default param
-- to create_group, but that's the same overload-ambiguity trap hit
-- repeatedly today: the intermediate (nickname-only, no timezone) signature
-- from the previous migration is still sitting in the catalog, and
-- PostgREST can no longer pick a candidate for a call that omits
-- p_timezone. Drop the superseded overload.
drop function if exists create_group(text, int, int, boolean, season_length, citext);
