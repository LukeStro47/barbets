-- Same lesson, a fourth time: adding p_accepting_members as a new trailing
-- default param to update_group_settings did not replace the previous
-- 7-param (pre-accepting_members) signature. Drop it so only the current
-- 8-param version remains.
drop function if exists update_group_settings(uuid, int, int, boolean, season_length, text, boolean);
