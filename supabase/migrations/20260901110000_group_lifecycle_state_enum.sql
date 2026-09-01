-- New enum for the admin panel's group lifecycle state model (GRP-STATE). This is
-- deliberately a fourth, explicitly-named "active"-adjacent concept in this codebase,
-- alongside admin_group_stats()'s 14-day market+bet definition and
-- get_platform_admin_stats()'s "not scheduled for deletion" definition -- see
-- ARCHITECTURE.md for why these must not be conflated. The 'active' value here is
-- deliberately aligned to reuse admin_group_stats()'s own rule rather than invent a
-- fifth meaning of the word.
--
-- Its own migration/transaction, separate from anything that references the type,
-- same rule as every other enum add in this codebase (see group_delete_event_type).
create type group_lifecycle_state as enum (
  'new',
  'active',
  'cooling',
  'stale',
  'winding_down',
  'intermission',
  'scheduled_for_deletion',
  'dormant'
);
