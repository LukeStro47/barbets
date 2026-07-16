-- New value split into its own migration first: ALTER TYPE ... ADD VALUE
-- can't be used in the same transaction it's added in, same two-file split
-- every prior notification_event_type addition used.
alter type notification_event_type add value 'clarification_requested';
alter type notification_event_type add value 'criteria_updated';
