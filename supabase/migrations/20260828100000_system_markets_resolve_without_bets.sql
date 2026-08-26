-- expire_stale()'s market_close sweep force-voids any market that reaches closes_at with zero
-- bets, on the reasoning that a market nobody bet on has nothing left to determine. That's right
-- for a member-created market, but wrong for a Sports/Weather system market: those resolve
-- against a real external outcome (a final score, a forecast) regardless of whether anyone bet on
-- them, and the whole point of the pipeline is that the outcome gets recorded either way. Before
-- this, expire_stale() runs every minute -- far more often than the 30-minute resolve cadence --
-- so a zero-bet sports/weather market was getting voided within a minute of closing, before
-- sports-resolve-markets/weather-resolve-markets ever got a chance to see it (both query
-- status in ('open', 'closed'), and 'voided' isn't in that set).
--
-- is_system_market is the signal, not creator_id is null: creator_id was repurposed by
-- 20260823100000 as an ON DELETE SET NULL target, so a perfectly ordinary member-created market
-- ends up with a null creator_id the moment its creator deletes their account. That would have
-- made a real deleted-creator market skip auto-void too, which is wrong. A dedicated column keeps
-- the two cases apart regardless of what happens to the creator later.
alter table markets add column is_system_market boolean not null default false;

-- _create_system_market: identical body to 20260826120000's version except the insert now stamps
-- is_system_market = true. Same signature, plain CREATE OR REPLACE.
create or replace function _create_system_market(
  p_group_id uuid,
  p_title text,
  p_description text,
  p_market_type market_type,
  p_closes_at timestamptz,
  p_line numeric default null,
  p_unit text default null
) returns markets
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group groups%rowtype;
  v_title text;
  v_unit text;
  v_market markets%rowtype;
  v_pending_bonus int;
begin
  select * into v_group from groups where id = p_group_id;
  if v_group.id is null or not v_group.is_public then
    raise exception 'invalid_operation: system markets can only be created in a public group';
  end if;

  if v_group.deletion_scheduled_at is not null then
    raise exception 'invalid_operation: this group is scheduled for deletion and can''t start new markets';
  end if;

  if p_market_type not in ('yes_no', 'over_under') then
    raise exception 'invalid_operation: system markets support yes_no or over_under only';
  end if;

  v_title := nullif(trim(p_title), '');
  if v_title is null then
    raise exception 'invalid_operation: market title can''t be blank';
  end if;
  if length(v_title) > 140 then
    raise exception 'invalid_operation: market title must be 140 characters or fewer';
  end if;

  if p_closes_at <= now() then
    raise exception 'invalid_operation: closes_at must be in the future';
  end if;

  v_unit := nullif(trim(coalesce(p_unit, '')), '');
  if v_unit is not null then
    if p_market_type <> 'over_under' then
      raise exception 'invalid_operation: a unit only applies to over/under markets';
    end if;
    if length(v_unit) > 10 then
      raise exception 'invalid_operation: unit must be 10 characters or fewer';
    end if;
  end if;

  insert into markets (group_id, season_id, title, description, market_type, line, creator_id, closes_at, unit, status, is_system_market)
  values (p_group_id, null, v_title, p_description, p_market_type, p_line, null, p_closes_at, v_unit, 'open', true)
  returning * into v_market;

  select pending_bonus_pool into v_pending_bonus from groups where id = p_group_id for update;
  if v_pending_bonus > 0 then
    update markets set bonus_pool = v_pending_bonus, carried_bonus_pool = v_pending_bonus where id = v_market.id
    returning * into v_market;
    update groups set pending_bonus_pool = 0 where id = p_group_id;
  end if;

  perform _emit_notification_event('market_opened', p_group_id, v_market.id, null, null);

  return v_market;
end;
$$;

revoke execute on function _create_system_market(uuid, text, text, market_type, timestamptz, numeric, text) from public;
revoke execute on function _create_system_market(uuid, text, text, market_type, timestamptz, numeric, text) from authenticated;
grant execute on function _create_system_market(uuid, text, text, market_type, timestamptz, numeric, text) to service_role;

-- expire_stale(): identical to 20260822120500's version except the market_close loop now also
-- selects is_system_market and treats it the same as "has bets" -- close and notify, don't void.
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
    select id, group_id, is_system_market from markets
    where status = 'open' and closes_at <= now()
    for update skip locked
  loop
    begin
      if rec.is_system_market or exists (select 1 from bets where market_id = rec.id) then
        update markets set status = 'closed', closed_at = now() where id = rec.id;
        perform _emit_notification_event('market_closed', rec.group_id, rec.id);
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
    select id from groups
    where deletion_scheduled_at is not null and deletion_scheduled_at <= now()
  loop
    begin
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
