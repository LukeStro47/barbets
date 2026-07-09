-- create_group: the creator becomes owner and first member, seeded and
-- active immediately regardless of the seasons setting (they're starting
-- the group to play right away). p_season_length must be null iff
-- p_seasons_enabled is false, matching group_settings' own check constraint.
create or replace function create_group(
  p_name text,
  p_seed_amount int,
  p_bet_cap_pct int,
  p_seasons_enabled boolean default false,
  p_season_length season_length default null
) returns groups
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_group groups%rowtype;
  v_invite_code citext;
  v_membership_id uuid;
begin
  if v_user_id is null then
    raise exception 'not_found: unauthenticated';
  end if;

  loop
    v_invite_code := 'BB-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 4));
    exit when not exists (select 1 from groups where invite_code = v_invite_code);
  end loop;

  insert into groups (name, owner_id, invite_code)
  values (p_name, v_user_id, v_invite_code)
  returning * into v_group;

  insert into group_settings (group_id, seed_amount, bet_cap_pct, seasons_enabled, season_length)
  values (v_group.id, p_seed_amount, p_bet_cap_pct, p_seasons_enabled, p_season_length);

  if p_seasons_enabled then
    insert into seasons (group_id, number, status, seed_amount, bet_cap_pct)
    values (v_group.id, 1, 'active', p_seed_amount, p_bet_cap_pct);
  end if;

  insert into memberships (group_id, user_id, balance, status)
  values (v_group.id, v_user_id, p_seed_amount, 'active')
  returning id into v_membership_id;

  insert into ledger (membership_id, amount, reason)
  values (v_membership_id, p_seed_amount, 'seed');

  return v_group;
end;
$$;

revoke execute on function create_group(text, int, int, boolean, season_length) from public;
grant execute on function create_group(text, int, int, boolean, season_length) to authenticated;

-- join_group: idempotent (re-using an invite link you're already a member
-- via is a no-op, not an error). Seeding behavior branches on the group's
-- season state: seasons off -> seed immediately from group_settings;
-- mid-season -> seed immediately from the active season's snapshot;
-- between seasons (intermission) -> join dormant with a zero balance and an
-- automatic opt-in to the upcoming season, so start_season() picks them up
-- without a separate manual step.
create or replace function join_group(p_invite_code text)
returns memberships
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_group groups%rowtype;
  v_settings group_settings%rowtype;
  v_active_season seasons%rowtype;
  v_intermission_season seasons%rowtype;
  v_membership memberships%rowtype;
  v_seed int;
begin
  select * into v_group from groups where invite_code = p_invite_code::citext;
  if v_group.id is null then
    raise exception 'not_found: invalid invite code';
  end if;

  select * into v_membership from memberships where group_id = v_group.id and user_id = v_user_id;
  if v_membership.id is not null then
    if v_membership.status = 'removed' then
      raise exception 'forbidden: you have been removed from this group';
    end if;
    return v_membership;
  end if;

  select * into v_settings from group_settings where group_id = v_group.id;

  if v_settings.seasons_enabled then
    select * into v_active_season from seasons where group_id = v_group.id and status = 'active';
  end if;

  if v_settings.seasons_enabled and v_active_season.id is null then
    select * into v_intermission_season from seasons where group_id = v_group.id and status = 'intermission';

    insert into memberships (group_id, user_id, balance, status)
    values (v_group.id, v_user_id, 0, 'dormant')
    returning * into v_membership;

    if v_intermission_season.id is not null then
      insert into season_optins (season_id, user_id)
      values (v_intermission_season.id, v_user_id)
      on conflict do nothing;
    end if;

    return v_membership;
  end if;

  v_seed := case when v_settings.seasons_enabled then v_active_season.seed_amount else v_settings.seed_amount end;

  insert into memberships (group_id, user_id, balance, status)
  values (v_group.id, v_user_id, v_seed, 'active')
  returning * into v_membership;

  insert into ledger (membership_id, amount, reason)
  values (v_membership.id, v_seed, 'seed');

  return v_membership;
end;
$$;

revoke execute on function join_group(text) from public;
grant execute on function join_group(text) to authenticated;

-- remove_member: owner-only. Voids+refunds any non-terminal market the
-- target is a subject of (wholesale, everyone refunded), then refunds the
-- target's own open bets in markets they are NOT a subject of (those are
-- unaffected for everyone else). settled_at on bets makes the second pass
-- naturally skip anything the first pass already refunded.
create or replace function remove_member(p_group_id uuid, p_target_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_group groups%rowtype;
  rec record;
begin
  select * into v_group from groups where id = p_group_id;
  if v_group.id is null then
    raise exception 'not_found: group not found';
  end if;
  if v_caller <> v_group.owner_id then
    raise exception 'forbidden: only the group owner can remove members';
  end if;
  if p_target_user_id = v_group.owner_id then
    raise exception 'invalid_operation: the owner cannot remove themself';
  end if;

  perform 1 from memberships
  where group_id = p_group_id and user_id = p_target_user_id and status <> 'removed'
  for update;
  if not found then
    raise exception 'not_found: user is not a member of this group';
  end if;

  for rec in
    select m.id
    from markets m
    join market_subjects ms on ms.market_id = m.id
    where m.group_id = p_group_id
      and ms.user_id = p_target_user_id
      and m.status not in ('resolved', 'voided')
    for update of m
  loop
    perform _void_market(rec.id);
  end loop;

  for rec in
    select b.id
    from bets b
    join markets m on m.id = b.market_id
    where b.user_id = p_target_user_id
      and m.group_id = p_group_id
      and m.status not in ('resolved', 'voided')
      and b.settled_at is null
  loop
    perform _refund_single_bet(rec.id);
  end loop;

  update memberships set status = 'removed'
  where group_id = p_group_id and user_id = p_target_user_id;
end;
$$;

revoke execute on function remove_member(uuid, uuid) from public;
grant execute on function remove_member(uuid, uuid) to authenticated;
