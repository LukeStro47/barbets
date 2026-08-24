-- New event: a platform admin assigned someone as a public group's moderator directly (by email,
-- without them having joined first — see create_public_group()'s rewrite). ALTER TYPE ... ADD VALUE
-- cannot be used in the same transaction that adds it, so this migration only adds the value; the
-- check constraint, _notification_category, get_event_recipients, and the function that actually
-- emits it all land in a later, separate migration today.
alter type notification_event_type add value 'assigned_group_moderator';
