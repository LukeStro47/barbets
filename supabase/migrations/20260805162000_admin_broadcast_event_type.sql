-- Schema-only: adds the new enum value and the two free-text columns
-- notification_events needs to carry an admin-typed broadcast. Deliberately
-- split from the migration that actually references the new enum value
-- (20260805163000) — Postgres forbids using a value added by ALTER TYPE ...
-- ADD VALUE until the transaction that added it has committed, and every
-- prior event type in this codebase already splits enum-add from first-use
-- across separate migrations for exactly this reason (e.g.
-- 20260709140000_betting_opened_event_type.sql -> 20260709141000_betting_opened_notification.sql).
alter type notification_event_type add value 'admin_broadcast';

alter table notification_events add column custom_title text;
alter table notification_events add column custom_body text;
