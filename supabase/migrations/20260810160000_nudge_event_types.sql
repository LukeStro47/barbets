-- Two new event types for the inactivity nudges (see 20260810162000_nudges.sql
-- for the sweep that emits them). Added in their own migration, with nothing
-- else in it, for the same reason every prior notification_event_type addition
-- in this project was: a newly added enum value can't be referenced by anything
-- in the same transaction that added it.
alter type notification_event_type add value 'weekend_nudge';
alter type notification_event_type add value 'market_closing_soon';
