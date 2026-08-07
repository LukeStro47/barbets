-- New membership_status value for a clean, self-service leave. 'dormant'
-- can't be repurposed for this — it's independently used for a brand-new
-- member who joins mid-intermission and is legitimately still "in" the
-- group waiting for the next season to start (see join_group). Leaving
-- needs its own terminal-but-rejoinable state, distinct from both 'dormant'
-- and 'removed'. Standalone migration: Postgres can't use a freshly-added
-- enum value in the same transaction that adds it (same pattern already
-- used for season_status's 'winding_down' value).
alter type membership_status add value 'left' after 'dormant';
