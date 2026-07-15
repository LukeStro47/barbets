-- Split into its own migration, same reasoning as every other
-- notification_event_type addition in this project: a newly added enum
-- value can't be referenced by any function or constraint in the same
-- transaction it was added in.
alter type notification_event_type add value 'group_titles_updated';
