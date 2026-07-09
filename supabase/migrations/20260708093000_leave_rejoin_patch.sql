-- Leave/rejoin patch: closes two exploits in the old leave/remove/join flow.
--
-- 1. Leaving no longer refunds the leaver's own open bets — those stakes
--    stay in their pools and settle normally, crediting the (now dormant)
--    membership's balance via the ledger as usual. This closes the "peek at
--    closed-market odds, then bail via Leave to get your stake back" hole.
--    Markets where the leaver is a *subject* are still voided+refunded
--    (unavoidable — the market's premise left the group), unchanged.
--
-- 2. Self-service leave_group() now sets status = 'dormant', not 'removed'.
--    Owner-initiated remove_member() still sets 'removed'. This is the key
--    design choice that makes both halves of the spec fall out of the
--    existing dormant/removed vocabulary with no new enum value: dormant
--    members can rejoin (join_group reactivates them, balance intact, never
--    reseeded — see below), while removed members are permanently blocked.
--    A kicked member didn't choose to leave, so remove_member() keeps
--    refunding their own open bets too (not the bail-out exploit) and now
--    additionally rotates the group's invite code, killing the removed
--    member's known code.
--
-- _cleanup_departing_member() gets a p_refund_own_bets flag so the two
-- callers can diverge on exactly that one behavior while sharing everything
-- else (subject-market voiding, season_optins cleanup).

create or replace function _cleanup_departing_member(p_group_id uuid, p_user_id uuid, p_refund_own_bets boolean default true)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  rec record;
begin
  for rec in
    select m.id
    from markets m
    join market_subjects ms on ms.market_id = m.id
    where m.group_id = p_group_id
      and ms.user_id = p_user_id
      and m.status not in ('resolved', 'voided')
    for update of m
  loop
    perform _void_market(rec.id);
  end loop;

  if p_refund_own_bets then
    for rec in
      select b.id
      from bets b
      join markets m on m.id = b.market_id
      where b.user_id = p_user_id
        and m.group_id = p_group_id
        and m.status not in ('resolved', 'voided')
        and b.settled_at is null
    loop
      perform _refund_single_bet(rec.id);
    end loop;
  end if;

  delete from season_optins so
  using seasons s
  where so.season_id = s.id
    and s.group_id = p_group_id
    and so.user_id = p_user_id;
end;
$$;

revoke execute on function _cleanup_departing_member(uuid, uuid, boolean) from public;
revoke execute on function _cleanup_departing_member(uuid, uuid, boolean) from authenticated;

-- Shared collision-retry invite code generator, factored out of
-- create_group()/regenerate_invite_code() now that remove_member() needs
-- the exact same logic as a third call site.
create or replace function _generate_invite_code()
returns citext
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite_code citext;
begin
  loop
    v_invite_code := 'BB-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 4));
    exit when not exists (select 1 from groups where invite_code = v_invite_code);
  end loop;
  return v_invite_code;
end;
$$;

revoke execute on function _generate_invite_code() from public;
revoke execute on function _generate_invite_code() from authenticated;

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
  v_membership_id uuid;
begin
  if v_user_id is null then
    raise exception 'not_found: unauthenticated';
  end if;

  insert into groups (name, owner_id, invite_code)
  values (p_name, v_user_id, _generate_invite_code())
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

create or replace function regenerate_invite_code(p_group_id uuid)
returns groups
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_group groups%rowtype;
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
    raise exception 'forbidden: only the group owner can regenerate the invite code';
  end if;

  update groups set invite_code = _generate_invite_code() where id = p_group_id returning * into v_group;

  return v_group;
end;
$$;

revoke execute on function regenerate_invite_code(uuid) from public;
grant execute on function regenerate_invite_code(uuid) to authenticated;

-- join_group: existing membership now branches three ways instead of two.
-- 'removed' -> permanent rejection. 'dormant' -> reactivate in place with
-- whatever balance is already sitting there — never reseed. 'active' is
-- still the pre-existing idempotent no-op (re-using an invite link you're
-- already an active member via).
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
      raise exception 'forbidden: you can''t rejoin this group';
    end if;
    if v_membership.status = 'dormant' then
      update memberships set status = 'active' where id = v_membership.id returning * into v_membership;
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

-- remove_member: unchanged eligibility/void/refund behavior, plus an
-- invite-code rotation in the same transaction so the removed member's
-- known code is dead going forward.
create or replace function remove_member(p_group_id uuid, p_target_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_group groups%rowtype;
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

  perform _cleanup_departing_member(p_group_id, p_target_user_id, true);

  update memberships set status = 'removed'
  where group_id = p_group_id and user_id = p_target_user_id;

  update groups set invite_code = _generate_invite_code() where id = p_group_id;
end;
$$;

revoke execute on function remove_member(uuid, uuid) from public;
grant execute on function remove_member(uuid, uuid) to authenticated;

-- leave_group: no longer refunds the leaver's own open bets, and returns to
-- 'dormant' (not 'removed') so a later join_group() call can bring them back
-- with whatever balance settled while they were away.
create or replace function leave_group(p_group_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_group groups%rowtype;
begin
  select * into v_group from groups where id = p_group_id;
  if v_group.id is null then
    raise exception 'not_found: group not found';
  end if;

  perform 1 from memberships where group_id = p_group_id and user_id = v_user_id and status <> 'removed' for update;
  if not found then
    raise exception 'not_found: group not found';
  end if;

  if v_user_id = v_group.owner_id then
    raise exception 'invalid_operation: the owner cannot leave their own group';
  end if;

  perform _cleanup_departing_member(p_group_id, v_user_id, false);

  update memberships set status = 'dormant'
  where group_id = p_group_id and user_id = v_user_id;
end;
$$;

revoke execute on function leave_group(uuid) from public;
grant execute on function leave_group(uuid) to authenticated;
