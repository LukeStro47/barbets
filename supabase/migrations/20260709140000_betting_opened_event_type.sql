-- New enum value needs its own transaction/migration — Postgres won't let a
-- freshly-added enum value be referenced until the adding transaction has
-- committed (same rule multiple_choice hit).
alter type notification_event_type add value 'betting_opened';
