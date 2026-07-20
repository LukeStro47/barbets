-- start_season: reseed rule now unions two default populations instead of
-- reading a single opt-in table — a currently-active member is included by
-- default (opt_out_season to skip), a currently-dormant member stays
-- dormant unless they've explicitly asked in via the existing, unchanged
-- season_optins/opt_in_season mechanism. Also freezes ends_at/season_length
-- onto the season row (fixing the "editing settings mid-season moves the
-- live season's end" bug), starts every season with betting paused, and
-- clears any inactivity-triggered pending deletion.
create or replace function start_season(p_group_id uuid)
returns seasons
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_group groups%rowtype;
  v_settings group_settings%rowtype;
  v_season seasons%rowtype;
  v_ends_at timestamptz;
  rec record;
begin
  select * into v_group from groups where id = p_group_id;
  if v_group.id is null then
    raise exception 'not_found: group not found';
  end if;

  perform 1 from memberships where group_id = p_group_id and user_id = v_caller and status <> 'removed';
  if not found then
    raise exception 'not_found: group not found';
  end if;

  if v_caller <> v_group.owner_id then
    raise exception 'forbidden: only the group owner can start the season';
  end if;

  select * into v_settings from group_settings where group_id = p_group_id;

  select * into v_season from seasons where group_id = p_group_id and status = 'intermission' for update;
  if v_season.id is null then
    raise exception 'invalid_operation: no season is in intermission, end the current season first';
  end if;

  v_ends_at := _compute_season_ends_at(v_settings.season_length, v_settings.season_custom_ends_at, now());
  if v_settings.season_length = 'custom' and v_ends_at <= now() then
    raise exception 'invalid_operation: that custom end date has already passed, pick a new one in settings before continuing';
  end if;

  update seasons
  set status = 'active', started_at = now(),
      seed_amount = v_settings.seed_amount,
      ends_at = v_ends_at,
      season_length = v_settings.season_length,
      betting_open = false
  where id = v_season.id
  returning * into v_season;

  for rec in
    select m.user_id
    from memberships m
    where m.group_id = p_group_id and m.status <> 'removed'
      and (
        (m.status = 'active' and not exists (
          select 1 from season_optouts so where so.season_id = v_season.id and so.user_id = m.user_id
        ))
        or
        (m.status = 'dormant' and exists (
          select 1 from season_optins si where si.season_id = v_season.id and si.user_id = m.user_id
        ))
      )
  loop
    update memberships
    set status = 'active', balance = v_season.seed_amount
    where group_id = p_group_id and user_id = rec.user_id;

    insert into ledger (membership_id, amount, reason)
    select id, v_season.seed_amount, 'seed'
    from memberships where group_id = p_group_id and user_id = rec.user_id;
  end loop;

  update memberships
  set status = 'dormant'
  where group_id = p_group_id
    and status <> 'removed'
    and user_id not in (
      select m.user_id
      from memberships m
      where m.group_id = p_group_id and m.status <> 'removed'
        and (
          (m.status = 'active' and not exists (
            select 1 from season_optouts so where so.season_id = v_season.id and so.user_id = m.user_id
          ))
          or
          (m.status = 'dormant' and exists (
            select 1 from season_optins si where si.season_id = v_season.id and si.user_id = m.user_id
          ))
        )
    );

  -- Continuing cancels a pending inactivity-triggered deletion outright —
  -- the existing "the owner canceled the deletion" copy stays accurate,
  -- since starting a season really is what canceled it.
  if v_group.deletion_scheduled_at is not null then
    update groups set deletion_scheduled_at = null where id = p_group_id;
    perform _emit_notification_event('group_deletion_canceled', p_group_id, null, null, v_caller);
  end if;

  return v_season;
end;
$$;

revoke execute on function start_season(uuid) from public;
grant execute on function start_season(uuid) to authenticated;

-- opt_out_season: a currently-active member pre-emptively skips the next
-- season. Mirrors opt_in_season's existing validation shape and its
-- "already active -> apply immediately" late-action behavior, just for the
-- opposite population and direction.
create function opt_out_season(p_season_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_season seasons%rowtype;
  v_row_count int;
begin
  select * into v_season from seasons where id = p_season_id for update;
  if v_season.id is null then
    raise exception 'not_found: season not found';
  end if;

  perform 1 from memberships
  where group_id = v_season.group_id and user_id = v_user_id and status <> 'removed';
  if not found then
    raise exception 'not_found: not a member of this group';
  end if;

  if v_season.status not in ('intermission', 'active') then
    raise exception 'invalid_operation: this season is no longer accepting opt-outs';
  end if;

  insert into season_optouts (season_id, user_id)
  values (p_season_id, v_user_id)
  on conflict do nothing;

  get diagnostics v_row_count = row_count;

  if v_season.status = 'active' and v_row_count > 0 then
    update memberships set status = 'dormant'
    where group_id = v_season.group_id and user_id = v_user_id;
  end if;
end;
$$;

revoke execute on function opt_out_season(uuid) from public;
grant execute on function opt_out_season(uuid) to authenticated;

-- cancel_season_optout: the undo. If the season's already active and the
-- member had actually been dormant because of the opt-out, reactivate and
-- reseed them immediately — same late-reactivation shape opt_in_season uses.
create function cancel_season_optout(p_season_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_season seasons%rowtype;
  v_row_count int;
begin
  select * into v_season from seasons where id = p_season_id for update;
  if v_season.id is null then
    raise exception 'not_found: season not found';
  end if;

  perform 1 from memberships
  where group_id = v_season.group_id and user_id = v_user_id and status <> 'removed';
  if not found then
    raise exception 'not_found: not a member of this group';
  end if;

  delete from season_optouts where season_id = p_season_id and user_id = v_user_id;
  get diagnostics v_row_count = row_count;

  if v_season.status = 'active' and v_row_count > 0 then
    update memberships
    set status = 'active', balance = v_season.seed_amount
    where group_id = v_season.group_id and user_id = v_user_id and status = 'dormant';

    if found then
      insert into ledger (membership_id, amount, reason)
      select id, v_season.seed_amount, 'seed'
      from memberships where group_id = v_season.group_id and user_id = v_user_id;
    end if;
  end if;
end;
$$;

revoke execute on function cancel_season_optout(uuid) from public;
grant execute on function cancel_season_optout(uuid) to authenticated;

-- rename_season: owner-only, works in any season status. Blank clears back
-- to the "Season N" display fallback.
create function rename_season(p_season_id uuid, p_name text)
returns seasons
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_season seasons%rowtype;
  v_owner_id uuid;
  v_clean text;
begin
  select * into v_season from seasons where id = p_season_id for update;
  if v_season.id is null then
    raise exception 'not_found: season not found';
  end if;

  perform 1 from memberships where group_id = v_season.group_id and user_id = v_caller and status <> 'removed';
  if not found then
    raise exception 'not_found: season not found';
  end if;

  select owner_id into v_owner_id from groups where id = v_season.group_id;
  if v_caller <> v_owner_id then
    raise exception 'forbidden: only the group owner can rename a season';
  end if;

  v_clean := nullif(trim(p_name), '');

  update seasons set name = v_clean where id = p_season_id returning * into v_season;

  return v_season;
end;
$$;

revoke execute on function rename_season(uuid, text) from public;
grant execute on function rename_season(uuid, text) to authenticated;

-- open_season_betting: owner-only per-season betting gate. Requires an
-- active season (winding_down/intermission/archived all reject).
create function open_season_betting(p_season_id uuid)
returns seasons
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_season seasons%rowtype;
  v_owner_id uuid;
begin
  select * into v_season from seasons where id = p_season_id for update;
  if v_season.id is null then
    raise exception 'not_found: season not found';
  end if;

  perform 1 from memberships where group_id = v_season.group_id and user_id = v_caller and status <> 'removed';
  if not found then
    raise exception 'not_found: season not found';
  end if;

  select owner_id into v_owner_id from groups where id = v_season.group_id;
  if v_caller <> v_owner_id then
    raise exception 'forbidden: only the group owner can open betting';
  end if;

  if v_season.status <> 'active' then
    raise exception 'invalid_operation: this season is not active';
  end if;

  if v_season.betting_open then
    raise exception 'invalid_operation: betting is already open for this season';
  end if;

  update seasons set betting_open = true where id = p_season_id returning * into v_season;

  -- season_id intentionally omitted (null) — recipients are resolved by
  -- group, same as the existing betting_opened event, and
  -- notification_events_season_ended_has_season only allows a non-null
  -- season_id on 'season_ended' rows.
  perform _emit_notification_event('season_betting_opened', v_season.group_id, null, null, v_caller);

  return v_season;
end;
$$;

revoke execute on function open_season_betting(uuid) from public;
grant execute on function open_season_betting(uuid) to authenticated;
