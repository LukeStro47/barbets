-- The same bug class as notification_events.actor_id (20260822160000) and
-- markets.creator_id/sponsor_id (20260823100000), closed out for the rest of
-- the audit: every remaining column that references users(id) with no
-- on delete clause, which defaults to NO ACTION and silently blocks
-- deleteAccount()'s admin.auth.admin.deleteUser() call for anyone still
-- referenced by such a row.
--
-- bets.user_id is very likely the highest-impact of the whole set found in
-- this audit: it is set on every bet a user ever places, not a role most
-- users only occupy occasionally (creating or sponsoring a market). A large
-- share of real users who have ever placed a bet could not self-delete
-- their account before this migration.
--
-- None of bets/votes/challenges/resolution_proposals/resolution_clarifications
-- rows are ever deleted by _cleanup_departing_member() (it only refunds or
-- voids), so a settled row surviving with a null actor is exactly the same
-- "historical record doesn't need the actor's account to still exist"
-- reasoning already applied to the two prior fixes. market_subjects.user_id,
-- the sixth column this audit checked, turned out to already be
-- `on delete cascade` from its original migration — no fix needed there.
--
-- All five were `not null`, so each needs `drop not null` before
-- `on delete set null` can apply (a not-null column can never receive the
-- null that action would try to write).
alter table bets alter column user_id drop not null;
alter table bets drop constraint bets_user_id_fkey;
alter table bets add constraint bets_user_id_fkey
  foreign key (user_id) references users (id) on delete set null;

alter table votes alter column voter_id drop not null;
alter table votes drop constraint votes_voter_id_fkey;
alter table votes add constraint votes_voter_id_fkey
  foreign key (voter_id) references users (id) on delete set null;

alter table challenges alter column challenger_id drop not null;
alter table challenges drop constraint challenges_challenger_id_fkey;
alter table challenges add constraint challenges_challenger_id_fkey
  foreign key (challenger_id) references users (id) on delete set null;

alter table resolution_proposals alter column proposer_id drop not null;
alter table resolution_proposals drop constraint resolution_proposals_proposer_id_fkey;
alter table resolution_proposals add constraint resolution_proposals_proposer_id_fkey
  foreign key (proposer_id) references users (id) on delete set null;

alter table resolution_clarifications alter column requester_id drop not null;
alter table resolution_clarifications drop constraint resolution_clarifications_requester_id_fkey;
alter table resolution_clarifications add constraint resolution_clarifications_requester_id_fkey
  foreign key (requester_id) references users (id) on delete set null;
