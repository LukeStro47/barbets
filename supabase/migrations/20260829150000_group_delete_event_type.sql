-- Adds a group_delete lifecycle event, for the admin site's "groups deleted" note. Its own
-- migration/transaction, separate from anything that uses the new value in a function body --
-- Postgres won't let a freshly added enum value be referenced within the same transaction that
-- added it.
alter type lifecycle_event_type add value 'group_delete';
