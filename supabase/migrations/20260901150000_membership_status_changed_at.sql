-- CHURN: memberships has never had a timestamp for when status last changed, only
-- joined_at. Needed to split membership churn into early (left shortly after
-- joining) versus late (a long-tenured member leaving) -- these usually mean
-- different things and a single churn rate hides which one is happening.
alter table memberships add column status_changed_at timestamptz;

-- Backfill: an honest approximation, not a real history. Nothing before this
-- migration ever recorded when a status actually changed, so every existing row is
-- stamped with its own joined_at -- an undercount for any membership whose status
-- changed before today, same caveat class as the lifecycle_events backfill gap.
update memberships set status_changed_at = joined_at;

-- First trigger in this codebase (groups/group_settings/seasons all have no
-- updated_at, by design elsewhere) -- new ground, not an established pattern being
-- copied. Not security definer: it fires inside whatever statement already reached
-- this row, which is always itself inside a security definer function already, since
-- RLS has no client update policy on memberships.
create function _touch_membership_status_changed_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.status_changed_at := now();
  return new;
end;
$$;

create trigger memberships_status_changed_at_trg
before update on memberships
for each row
when (old.status is distinct from new.status)
execute function _touch_membership_status_changed_at();
