-- 7-day login reward (GitHub #92): the two enum values the feature needs, in their own
-- migration/transaction ahead of anything that references them -- Postgres won't let a freshly
-- added enum value be used inside the same transaction that added it (same precedent as
-- 20260829150000_group_delete_event_type.sql).
--
-- 'reward': a ledger row for chips handed out by the app itself rather than won, refunded, or
-- seeded. Positive, no market, no bet. Counts toward net like a payout (membership_ledger_net
-- and get_member_stats() exclude only 'seed'), and is excluded from the "biggest win" stats
-- the same way a refund is (those filter on reason = 'payout').
alter type ledger_entry_type add value 'reward';

-- 'login_reward_ready': user-scoped, single-recipient (actor_id = the one person to notify,
-- impressive_bet's convention), emitted by _record_app_open() exactly when a streak becomes 7.
alter type notification_event_type add value 'login_reward_ready';
