-- 20260830220000 made accepted_policy_version NOT NULL with no column-level default, on the
-- reasoning that every real signup path explicitly stamps it via ensureProfileRow(). That missed
-- tests/integration/helpers/testUsers.ts, which inserts a bare `{ id }` row to mirror the app's
-- auto-created profile row (there's no equivalent global username to claim anymore) — with no
-- default, that insert now violates the NOT NULL constraint and every integration test that
-- creates a user breaks. A default is the same safety net notify_nudges/notify_promos already
-- have, matching the version live at the time of this migration; it's a fallback for a raw insert
-- that skips ensureProfileRow, not the source of truth for what a real user actually agreed to.
alter table users alter column accepted_policy_version set default '2026-08-27';
