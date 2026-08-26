-- Records a group_delete lifecycle event on both paths a group row can disappear from: the
-- owner-initiated delete_group() and expire_stale()'s final sweep loop (the grace-period path,
-- once a scheduled deletion's date actually arrives). The insert happens before the DELETE in
-- both cases, in the same transaction -- lifecycle_events.group_id is ON DELETE SET NULL, so the
-- row survives the group's deletion with group_id nulled out, and the group's name/id are also
-- captured in metadata so the record stays useful even after the FK nulls it out.

-- delete_group, redeclared from 20260806140000_delete_group_immediate.sql with one
-- lifecycle_events insert added before the delete. Same 1-parameter signature.
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

  insert into lifecycle_events (event_type, user_id, group_id, metadata)
  values ('group_delete', v_caller, p_group_id, jsonb_build_object('group_id', p_group_id, 'group_name', v_group.name, 'reason', 'owner'));

  delete from groups where id = p_group_id returning * into v_group;

  return v_group;
end;
$$;

revoke execute on function delete_group(uuid) from public;
grant execute on function delete_group(uuid) to authenticated;

-- expire_stale, redeclared from 20260828130000_public_group_pipeline_notifications.sql with one
-- lifecycle_events insert added to its final loop (the grace-period deletion sweep), inside the
-- same per-row exception block so a failed insert blocks that row's delete and gets retried next
-- tick rather than deleting without a record. No other loop in this function changes.
create or replace function expire_stale()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  rec record;
  rec2 record;
  v_context text;
begin
  for rec in
    select id from markets
    where status = 'pending_sponsor'
      and (created_at < now() - interval '24 hours' or closes_at <= now())
    for update skip locked
  loop
    begin
      update markets set status = 'voided', outcome = 'void', resolved_at = now()
      where id = rec.id;
    exception when others then
      get stacked diagnostics v_context = pg_exception_context;
      perform _record_sweep_failure('sponsor_expiry', rec.id, sqlstate, sqlerrm, v_context);
    end;
  end loop;

  for rec in
    select m.id, m.group_id, m.is_system_market, g.name as group_name
    from markets m
    join groups g on g.id = m.group_id
    where m.status = 'open' and m.closes_at <= now()
    for update of m skip locked
  loop
    begin
      if rec.is_system_market or exists (select 1 from bets where market_id = rec.id) then
        update markets set status = 'closed', closed_at = now() where id = rec.id;
        if not (rec.is_system_market and rec.group_name = 'Weather') then
          perform _emit_notification_event('market_closed', rec.group_id, rec.id);
        end if;
      else
        perform _void_market(rec.id);
      end if;
    exception when others then
      get stacked diagnostics v_context = pg_exception_context;
      perform _record_sweep_failure('market_close', rec.id, sqlstate, sqlerrm, v_context);
    end;
  end loop;

  for rec in
    select m.id
    from markets m
    join resolution_proposals rp on rp.market_id = m.id
    join group_settings gs on gs.group_id = m.group_id
    where m.status = 'proposed' and rp.proposed_at + (gs.resolution_window_hours * interval '1 hour') <= now()
  loop
    begin
      perform finalize_market(rec.id);
    exception when others then
      get stacked diagnostics v_context = pg_exception_context;
      perform _record_sweep_failure('finalize_proposed', rec.id, sqlstate, sqlerrm, v_context);
    end;
  end loop;

  for rec in
    select m.id
    from markets m
    join challenges c on c.market_id = m.id
    join group_settings gs on gs.group_id = m.group_id
    where m.status = 'disputed' and c.created_at + (gs.resolution_window_hours * interval '1 hour') <= now()
  loop
    begin
      perform finalize_market(rec.id);
    exception when others then
      get stacked diagnostics v_context = pg_exception_context;
      perform _record_sweep_failure('finalize_disputed', rec.id, sqlstate, sqlerrm, v_context);
    end;
  end loop;

  -- Wind-down hard cap: force-void anything still proposed/disputed once a
  -- winding_down season's grace window has elapsed, then archive it. Most
  -- winding-down seasons never reach here at all - finalize_market()'s tail
  -- hook already archives the moment the last in-flight market clears
  -- naturally (via the two loops just above, or a direct owner/voter call).
  for rec in
    select m.id
    from seasons s
    join markets m on m.season_id = s.id
    where s.status = 'winding_down' and s.wind_down_deadline <= now()
      and m.status in ('proposed', 'disputed')
    for update of m skip locked
  loop
    begin
      perform _void_market(rec.id);
    exception when others then
      get stacked diagnostics v_context = pg_exception_context;
      perform _record_sweep_failure('wind_down_void', rec.id, sqlstate, sqlerrm, v_context);
    end;
  end loop;

  for rec in
    select id from seasons where status = 'winding_down' and wind_down_deadline <= now()
  loop
    begin
      perform _maybe_archive_winding_down_season(rec.id);
    exception when others then
      get stacked diagnostics v_context = pg_exception_context;
      perform _record_sweep_failure('wind_down_archive', rec.id, sqlstate, sqlerrm, v_context);
    end;
  end loop;

  -- Timed season auto-end. Calls the internal _end_season() rather than
  -- end_season(), which gates on auth.uid() and therefore always raised when
  -- called from cron - see 20260813170000. NULL actor is the correct
  -- attribution here: nobody ended this season, its date arrived.
  for rec in
    select group_id from seasons where status = 'active' and ends_at is not null and ends_at <= now()
  loop
    begin
      perform _end_season(rec.group_id, null::uuid);
    exception when others then
      get stacked diagnostics v_context = pg_exception_context;
      perform _record_sweep_failure('season_auto_end', rec.group_id, sqlstate, sqlerrm, v_context);
    end;
  end loop;

  -- Wrapped per group rather than per market: voiding the group's leftover
  -- markets, scheduling the deletion and emitting the notice are one decision
  -- about one group and must not be able to half-happen.
  for rec in
    select s.group_id
    from seasons s
    join groups g on g.id = s.group_id
    where s.status = 'intermission'
      and s.started_at <= now() - interval '30 days'
      and g.deletion_scheduled_at is null
  loop
    begin
      for rec2 in
        select id from markets
        where group_id = rec.group_id and status not in ('resolved', 'voided')
        for update
      loop
        -- Defensive: intermission means no active season, so nothing new
        -- could've been created since the group entered it - this should
        -- already be an empty set every time.
        perform _void_market(rec2.id);
      end loop;

      -- Pre-stamps both reminder columns so the two general-reminder loops below
      -- never pick this group up: this flow keeps its original single 5-day
      -- notice, not a second, differently-timed reminder on top of it.
      update groups
      set deletion_scheduled_at = now() + interval '5 days',
          deletion_reminder_7d_sent_at = now(),
          deletion_reminder_1d_sent_at = now()
      where id = rec.group_id;
      perform _emit_notification_event('group_deletion_scheduled_inactivity', rec.group_id, null, null, null);
    exception when others then
      get stacked diagnostics v_context = pg_exception_context;
      perform _record_sweep_failure('intermission_deletion', rec.group_id, sqlstate, sqlerrm, v_context);
    end;
  end loop;

  -- General inactivity sweep: unlike the intermission-specific one above (which
  -- only ever applies to a seasons-enabled group sitting between seasons), this
  -- covers every group regardless of whether seasons are even turned on.
  -- "Inactive" means no market created and no bet placed anywhere in the group for
  -- 90 days. A group with any market that isn't resolved/voided is left alone
  -- outright rather than force-voided here - a quiet-but-not-empty group can
  -- easily have one real market with real stakes still open (unlike the
  -- intermission sweep above, whose defensive void is only ever expected to find
  -- an empty set), and 90 days of no *new* activity is not the same claim as
  -- "nothing here matters."
  for rec in
    select g.id
    from groups g
    left join (
      select group_id, max(created_at) as last_created from markets group by group_id
    ) lm on lm.group_id = g.id
    left join (
      select m.group_id, max(b.created_at) as last_bet
      from bets b
      join markets m on m.id = b.market_id
      group by m.group_id
    ) lb on lb.group_id = g.id
    where g.deletion_scheduled_at is null
      and not exists (
        select 1 from markets m2 where m2.group_id = g.id and m2.status not in ('resolved', 'voided')
      )
      and greatest(g.created_at, coalesce(lm.last_created, g.created_at), coalesce(lb.last_bet, g.created_at))
        <= now() - interval '90 days'
  loop
    begin
      update groups set deletion_scheduled_at = now() + interval '14 days' where id = rec.id;
      perform _emit_notification_event('group_deletion_notice_14d', rec.id, null, null, null);
    exception when others then
      get stacked diagnostics v_context = pg_exception_context;
      perform _record_sweep_failure('general_inactivity_deletion', rec.id, sqlstate, sqlerrm, v_context);
    end;
  end loop;

  -- The two follow-up reminders. Gated purely on the stamp columns being unset
  -- rather than on which sweep did the scheduling - the intermission sweep above
  -- pre-stamps both the moment it schedules a deletion, so in practice these two
  -- loops only ever pick up a deletion scheduled by the 90-day sweep just above,
  -- whose 14-day grace is the only one long enough to still have 7 or 1 days left
  -- to warn about.
  for rec in
    select id from groups
    where deletion_scheduled_at is not null
      and deletion_reminder_7d_sent_at is null
      and deletion_scheduled_at - now() <= interval '7 days'
  loop
    begin
      update groups set deletion_reminder_7d_sent_at = now() where id = rec.id;
      perform _emit_notification_event('group_deletion_notice_7d', rec.id, null, null, null);
    exception when others then
      get stacked diagnostics v_context = pg_exception_context;
      perform _record_sweep_failure('deletion_reminder_7d', rec.id, sqlstate, sqlerrm, v_context);
    end;
  end loop;

  for rec in
    select id from groups
    where deletion_scheduled_at is not null
      and deletion_reminder_1d_sent_at is null
      and deletion_scheduled_at - now() <= interval '1 day'
  loop
    begin
      update groups set deletion_reminder_1d_sent_at = now() where id = rec.id;
      perform _emit_notification_event('group_deletion_notice_1d', rec.id, null, null, null);
    exception when others then
      get stacked diagnostics v_context = pg_exception_context;
      perform _record_sweep_failure('deletion_reminder_1d', rec.id, sqlstate, sqlerrm, v_context);
    end;
  end loop;

  for rec in
    select id, name from groups
    where deletion_scheduled_at is not null and deletion_scheduled_at <= now()
  loop
    begin
      insert into lifecycle_events (event_type, user_id, group_id, metadata)
      values ('group_delete', null, rec.id, jsonb_build_object('group_id', rec.id, 'group_name', rec.name, 'reason', 'grace_period_expired'));

      delete from groups where id = rec.id;
    exception when others then
      get stacked diagnostics v_context = pg_exception_context;
      perform _record_sweep_failure('group_delete', rec.id, sqlstate, sqlerrm, v_context);
    end;
  end loop;
end;
$$;

revoke execute on function expire_stale() from public;
revoke execute on function expire_stale() from authenticated;
grant execute on function expire_stale() to service_role;

-- admin_group_stats(): the "active group" metric plus the deletion note for admin.mybarbets.com's
-- overview page. Scoped to private (is_public = false) groups for "active"/"total" -- Sports,
-- Weather, and campus groups are pipeline-driven or directory-joined, so counting them here would
-- dilute the one thing this metric exists to answer: are actual friend groups still coming back.
-- scheduled_for_deletion/deleted_last_30d count every group regardless of type, since deletion is
-- a platform-wide operational fact, not a friend-group-engagement one.
create function admin_group_stats(p_active_days int default 14)
returns table (
  active_private_groups bigint,
  total_private_groups bigint,
  scheduled_for_deletion bigint,
  deleted_last_30d bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not is_platform_admin() then
    raise exception 'forbidden: admin only';
  end if;

  return query
  select
    (
      select count(*) from groups g
      where g.is_public = false
        and exists (
          select 1 from lifecycle_events le
          where le.group_id = g.id and le.event_type = 'market_create' and le.created_at >= now() - (p_active_days || ' days')::interval
        )
        and exists (
          select 1 from lifecycle_events le
          where le.group_id = g.id and le.event_type = 'bet_place' and le.created_at >= now() - (p_active_days || ' days')::interval
        )
    ) as active_private_groups,
    (select count(*) from groups where is_public = false) as total_private_groups,
    (select count(*) from groups where deletion_scheduled_at is not null) as scheduled_for_deletion,
    (select count(*) from lifecycle_events where event_type = 'group_delete' and created_at >= now() - interval '30 days') as deleted_last_30d;
end;
$$;

revoke execute on function admin_group_stats(int) from public;
grant execute on function admin_group_stats(int) to authenticated;
