-- New value split into its own migration first: ALTER TYPE ... ADD VALUE
-- can't be used in the same transaction it's added in, same two-file split
-- every prior notification_event_type addition in this project has used
-- (see e.g. 20260805140000_market_opened_about_you_event_type.sql).
alter type notification_event_type add value 'market_comment_mention';
