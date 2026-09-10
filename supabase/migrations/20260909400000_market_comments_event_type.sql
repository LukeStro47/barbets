-- Comments on markets (GitHub #90): the one enum value the feature needs, in its own
-- migration/transaction ahead of anything that references it -- Postgres won't let a freshly
-- added enum value be used inside the same transaction that added it (same precedent as
-- 20260909200000_login_reward_enum_values.sql).
--
-- 'market_comments_heating_up': market-scoped, emitted by add_market_comment() when a market
-- collects 5+ live comments inside one minute, at most once per market per hour. actor_id is
-- the commenter who tipped it over, excluded like every other actor.
alter type notification_event_type add value 'market_comments_heating_up';
