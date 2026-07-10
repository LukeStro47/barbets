-- New enum value needs its own transaction/migration — Postgres won't let a
-- freshly-added enum value be referenced until the adding transaction has
-- committed (same rule betting_opened and multiple_choice both hit).
alter type notification_event_type add value 'member_joined';
