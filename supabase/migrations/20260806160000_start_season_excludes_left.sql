-- start_season()'s final step normalizes every non-reseeded, non-removed
-- member to 'dormant' — that blanket update didn't know about 'left' yet
-- and was sweeping left members back into 'dormant' on every season start,
-- silently reactivating their visibility/nickname semantics without them
-- ever rejoining. A left member isn't part of either reseed population
-- (they're neither 'active' nor 'dormant' to begin with) and should just
-- stay untouched — 'left' all the way through until they explicitly rejoin.
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

  perform 1 from memberships where group_id = p_group_id and user_id = v_caller and status not in ('removed', 'left');
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
    where m.group_id = p_group_id and m.status not in ('removed', 'left')
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
    and status not in ('removed', 'left')
    and user_id not in (
      select m.user_id
      from memberships m
      where m.group_id = p_group_id and m.status not in ('removed', 'left')
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
