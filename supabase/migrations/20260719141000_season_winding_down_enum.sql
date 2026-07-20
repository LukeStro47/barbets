-- New season_status value: a season that has stopped accepting new markets
-- and betting but still has one or more markets mid-resolution (proposed or
-- disputed) that get a grace window to finish naturally instead of being
-- force-voided the instant the season ends. See season_finalize_functions
-- migration for the full state machine.
alter type season_status add value 'winding_down' after 'active';
