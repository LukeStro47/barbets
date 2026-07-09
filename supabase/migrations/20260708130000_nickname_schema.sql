-- Replacing the global username with a per-group nickname. A member's
-- identity ("what's @'d") is now scoped to the group, not the whole app —
-- the same person can go by a different nickname in a different friend
-- group. Backfilled from each member's current username so nobody has to
-- re-enter anything; only brand-new joins from now on get prompted.
alter table memberships add column nickname citext;

update memberships m
set nickname = u.username
from users u
where u.id = m.user_id;

alter table memberships alter column nickname set not null;

alter table memberships add constraint memberships_nickname_format check (
  nickname::text ~ '^[A-Za-z0-9_]{1,20}$'
);

-- Unique among non-removed memberships only — a dormant member's nickname
-- stays reserved for them (mirrors the leave/rejoin patch's "dormant is
-- still theirs" treatment), but a removed member's old nickname frees up.
create unique index memberships_group_nickname_unique on memberships (group_id, nickname) where status <> 'removed';
