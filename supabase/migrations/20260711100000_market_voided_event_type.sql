-- New enum value needs its own transaction/migration — Postgres won't let a
-- freshly-added enum value be referenced until the adding transaction has
-- committed (same rule betting_opened, impressive_bet, and member_joined
-- all hit).
alter type notification_event_type add value 'market_voided';
