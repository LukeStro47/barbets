-- The same class of bug as notification_events.actor_id (20260822160000), and a much more
-- commonly-hit one: markets.creator_id and markets.sponsor_id both had no ON DELETE behavior,
-- which silently blocked deleteAccount()'s admin.auth.admin.deleteUser() call for anyone who had
-- ever created OR sponsored a single market, in any group, ever — not a 30-day retention window
-- like notification_events, forever, since a market itself has no purge sweep at all. That is very
-- likely most active users, not an edge case.
--
-- Found by reproducing the exact scenario directly against staging outside the test harness: after
-- the notification_events fix, deleting a user who had sponsored a market still failed, now with
-- "violates foreign key constraint markets_sponsor_id_fkey" instead. The existing integration test
-- that creates a sponsor and later cleans it up via cleanupTestUsers() never caught this either,
-- for the exact same reason as before — that helper swallows a failed delete with console.error
-- rather than throwing.
--
-- creator_id was `not null`, which on delete set null cannot honor directly (a NOT NULL column
-- can never receive a NULL from the ON DELETE action, that raises a constraint violation of its
-- own) — it has to become nullable first. HowItSettlesCard's "Started by" chip already renders
-- conditionally (`{creator && <SettlesChip>...}`), so a market whose creator has since deleted
-- their account already degrades to simply not showing that chip, no UI change needed.
--
-- on delete set null, not cascade: a market is real historical data (real bets, a real payout, a
-- real resolution) that has to survive its creator or sponsor deleting their account intact — only
-- the "who started/endorsed this" attribution needs to become anonymous, exactly the same tradeoff
-- already made for notification_events.actor_id and group_titles.user_id.
alter table markets alter column creator_id drop not null;

alter table markets drop constraint markets_creator_id_fkey;
alter table markets add constraint markets_creator_id_fkey
  foreign key (creator_id) references users (id) on delete set null;

alter table markets drop constraint markets_sponsor_id_fkey;
alter table markets add constraint markets_sponsor_id_fkey
  foreign key (sponsor_id) references users (id) on delete set null;
