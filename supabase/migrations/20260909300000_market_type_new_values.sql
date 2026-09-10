-- Two new market types (GitHub issue #87):
--
--   most_likely_to  a multiple-choice market whose options are members picked off the group
--                   roster instead of typed. Every named member is a subject of their own option,
--                   so the market is hidden from all of them until it resolves.
--   when            a date market whose four options are fixed time buckets (tonight, this
--                   weekend, this month, never), generated server-side at creation in the group's
--                   timezone so it still resolves to exactly one side.
--
-- Both reduce to multiple_choice underneath: market_options rows, bets.option_id,
-- markets.outcome_option_id, resolution_proposals.proposed_option_id, votes.voted_option_id.
-- The function changes live in 20260909310000_market_type_new_values_functions.sql.
--
-- Own migration file/transaction, same reason as 20260708110000_multiple_choice_enum.sql:
-- Postgres will not let a freshly added enum value be referenced in the transaction that added
-- it, so the values have to be committed before any function body mentions them.
alter type market_type add value 'most_likely_to';
alter type market_type add value 'when';
