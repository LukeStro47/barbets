-- Grace-period group deletion (see the next migration for the behavior
-- change): the column and the two new event types are split into their own
-- migration because a newly added enum value can't be referenced by any
-- function or constraint in the same transaction it was added in, same
-- reasoning as every other notification_event_type addition in this project.
alter table groups add column deletion_scheduled_at timestamptz;

alter type notification_event_type add value 'group_deletion_scheduled';
alter type notification_event_type add value 'group_deletion_canceled';
