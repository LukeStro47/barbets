-- Three new event types for the general (any-group, not just seasons/intermission)
-- 90-day inactivity deletion sweep added in the next migration: the initial
-- 14-days-out notice, plus two follow-up reminders at 7 days and 1 day out.
--
-- Kept distinct from group_deletion_scheduled_inactivity: that event's push copy is
-- hardcoded to the intermission-specific "30 days .../5 days" wording and links to
-- /intermission, both of which would be wrong for a group that was never in a season
-- at all (or is mid-season but just quiet).
--
-- New enum values have to land in their own migration, committed before anything
-- else references them — Postgres won't let a newly added value be used inside the
-- same transaction that added it.
alter type notification_event_type add value 'group_deletion_notice_14d';
alter type notification_event_type add value 'group_deletion_notice_7d';
alter type notification_event_type add value 'group_deletion_notice_1d';
