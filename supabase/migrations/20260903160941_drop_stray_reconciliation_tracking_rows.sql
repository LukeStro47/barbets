-- Bookkeeping only, no schema change. Fixing the update_group_settings overload regression and
-- the _create_system_market double-push bug (20260903140000, 20260903150000) was applied to the
-- staging project directly, ahead of a normal CI-driven migration, one statement per tool call.
-- Each of those calls recorded its own version in supabase_migrations.schema_migrations under a
-- timestamp that doesn't match any local migration filename, which then made CI's
-- `supabase db push --include-all` refuse to run ("Remote migration versions not found in local
-- migrations directory"). This deletes those five stray tracking rows so staging's history lines
-- up with what's actually in this directory. On a fresh database (nothing to delete, no rows
-- match) this is a genuine no-op, which is why it's safe to keep as a permanent migration file
-- rather than something to run once and discard.
delete from supabase_migrations.schema_migrations
where version in ('20260903145542', '20260903160020', '20260903160218', '20260903160307', '20260903160717');
