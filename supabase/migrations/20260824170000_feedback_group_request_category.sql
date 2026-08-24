-- Request-a-new-campus-group reuses the existing feedback pipeline (already Slack-notified,
-- already has a category field) rather than a new table and approval UI — reviewed manually via
-- the same Slack channel/admin console, not a self-serve approval flow in v1.
--
-- ALTER TYPE ... ADD VALUE cannot run in the same transaction as a statement that uses the new
-- value, so this migration only adds it — lib/actions/feedback.ts starts sending it in a later,
-- separate deploy step, same as every other enum addition in this codebase.
alter type feedback_category add value 'group_request';
