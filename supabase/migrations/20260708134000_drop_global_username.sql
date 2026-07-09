-- The global username is fully replaced by per-group nicknames now that
-- every reader (end_season snapshot, create_market's @mention resolution,
-- and every UI query) has moved off it. Safe to drop.
alter table users drop constraint users_username_format;
alter table users drop column username;
