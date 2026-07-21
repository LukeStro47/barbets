-- 20260719143000_season_formats_schema.sql added seasons.ends_at/season_length
-- via a bare ALTER TABLE ADD COLUMN with no backfill — any season that was
-- already active before that migration landed is stuck with both
-- permanently null, even though group_settings.season_length reflects the
-- group's real configured length (that's a separate column, always kept
-- current). This computes what create_group()/start_season() would have
-- frozen onto the row had the columns existed when it started, for every
-- currently in-flight season still missing it. Harmless no-op for any
-- season that already has season_length set (new seasons started after
-- 20260719143000 already freeze it correctly at start time).
update seasons s
set ends_at = _compute_season_ends_at(gs.season_length, gs.season_custom_ends_at, s.started_at),
    season_length = gs.season_length
from group_settings gs
where gs.group_id = s.group_id
  and s.season_length is null
  and gs.seasons_enabled = true
  and gs.season_length is not null
  and s.status in ('active', 'winding_down');
