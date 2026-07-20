-- New value split into its own migration first, same discipline as
-- 20260716120000_criteria_clarification_event_types.sql: ALTER TYPE ... ADD
-- VALUE can't be used in the same transaction as anything that references
-- the new value.
alter type season_length add value 'custom';
