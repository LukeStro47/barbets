-- Split into its own migration/transaction on purpose: PostgreSQL does not
-- allow a newly added enum value to be used (e.g. in a policy predicate) in
-- the same transaction that added it. remove_member() (Phase 2) needs a
-- terminal membership state distinct from 'dormant' (a removed member must
-- lose group access permanently, not just sit out a season).
alter type membership_status add value 'removed';
