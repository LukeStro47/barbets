-- delete_group is immediate again — no more 5-day grace period. Still voids
-- and refunds every non-terminal market first (same _void_market() helper
-- as before, so nobody's bet/vote is left dangling), then drops the group
-- row right away instead of scheduling it. Every group-scoped table
-- cascades from groups.id (confirmed when the grace-period version was
-- built), so a plain DELETE is still enough — no manual cleanup needed.
--
-- Deliberately NOT touching deletion_scheduled_at, cancel_group_deletion(),
-- or expire_stale()'s 30-day-abandoned-intermission sweep — that's a
-- separate, unrelated feature that shares the same column, and this change
-- only affects the owner-initiated delete path. cancel_group_deletion()
-- stays exactly as-is for undoing an inactivity-triggered deletion.
--
-- No group_deletion_scheduled notification is emitted from this path
-- anymore: an event row tied to this group_id would itself cascade-delete
-- (notification_events.group_id is ON DELETE CASCADE) before the send-push
-- cron ever gets a chance to read it, so it could never actually be
-- delivered — not worth a bigger redesign (e.g. a group_id-less event with
-- the name embedded) just for this.
create or replace function delete_group(p_group_id uuid)
returns groups
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_group groups%rowtype;
  rec record;
begin
  select * into v_group from groups where id = p_group_id for update;
  if v_group.id is null then
    raise exception 'not_found: group not found';
  end if;

  perform 1 from memberships where group_id = p_group_id and user_id = v_caller and status not in ('removed', 'left');
  if not found then
    raise exception 'not_found: group not found';
  end if;

  if v_caller <> v_group.owner_id then
    raise exception 'forbidden: only the group owner can delete the group';
  end if;

  for rec in
    select id from markets
    where group_id = p_group_id and status not in ('resolved', 'voided')
    for update
  loop
    perform _void_market(rec.id);
  end loop;

  delete from groups where id = p_group_id returning * into v_group;

  return v_group;
end;
$$;

revoke execute on function delete_group(uuid) from public;
grant execute on function delete_group(uuid) to authenticated;
