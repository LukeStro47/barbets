-- USR-SEG: user engagement segments, mirroring GRP-STATE at the person level.
-- Its own migration/transaction, same enum-add rule as group_lifecycle_state.
create type user_engagement_segment as enum (
  'new',
  'power',
  'casual',
  'at_risk',
  'dormant',
  'churned'
);
