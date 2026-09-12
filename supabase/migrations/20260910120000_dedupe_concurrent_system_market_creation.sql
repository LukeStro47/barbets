-- Real duplicate markets found in production 2026-09-10 (two identical "Will it rain in New
-- York today?" Weather markets 35ms apart) and 2026-09-08 (two identical NFL "Seahawks vs.
-- Patriots" markets). Edge Function logs for the Weather incident show pg_cron's single
-- scheduled trigger somehow reaching weather-create-markets as two separate, fully-independent
-- HTTP requests ~4ms apart (distinct request ids, both ran the full ~2s fetch+insert sequence
-- and both returned 200) -- most likely a network-level retry between Postgres and the Edge
-- Function, not a second cron entry (cron.job_run_details shows only one dispatch) and not a
-- second schedule (only one cron.job row exists for each of these functions).
--
-- Both weather-create-markets and sports-weekly-publish guard against recreating a market with a
-- plain check-then-insert (query "does one already exist?", then insert if not) -- two separate
-- round trips with nothing locking the gap between them. When two requests land close enough
-- together, both can pass the "doesn't exist yet" check before either has written its row, so
-- both create one. There was no database-level backstop behind that application-level check.
--
-- This closes the actual gap: a partial unique index means the second concurrent insert fails
-- with a real unique_violation (23505) instead of quietly succeeding twice. Scoped to
-- is_system_market and status in ('open', 'closed') rather than every market ever, for two
-- reasons: (1) a hand-created market (NFL/CFB/Weather mods can make one alongside the pipeline's
-- own, see ARCHITECTURE.md) never sets is_system_market, so it's never affected, and (2)
-- excluding resolved/voided rows means this doesn't have to touch or reconcile any of the
-- pipeline's existing history, including the handful of already-voided duplicate rows this same
-- incident produced -- a market is always inserted as 'open' (_create_system_market never
-- inserts any other status), so the race is caught the instant it would recur, and nothing about
-- a market's later lifecycle (close, resolve, void) needs this index to still hold.
create unique index markets_system_market_active_group_closes_at_key
  on markets (group_id, closes_at)
  where is_system_market and status in ('open', 'closed');
