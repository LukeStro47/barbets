-- Self-service "leave a group", requested after remove_member() already
-- existed for owner-initiated removal. The cleanup is identical either way
-- (void markets you're a subject of, refund your own open bets elsewhere),
-- so it's pulled into a shared helper both functions call.
--
-- Two bugs fixed along the way, found while writing this:
-- 1. Neither remove_member() nor the original design cleaned up
--    season_optins for a departing member. If they'd already opted into
--    the upcoming season, start_season() would happily reactivate and
--    reseed a 'removed' membership — a real privilege-escalation-adjacent
--    bug (a kicked/left member regaining access via a stale opt-in).
-- 2. start_season()'s reseed loop is hardened with an explicit
--    status <> 'removed' guard too, as defense-in-depth independent of the
--    season_optins cleanup above (belt and suspenders — either fix alone
--    would have closed the bug, both together make it robust against any
--    future path that inserts a season_optins row without knowing about
--    this edge case).

create or replace function _cleanup_departing_member(p_group_id uuid, p_user_id uuid)
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

  delete from season_optins so
  using seasons s
  where so.season_id = s.id
    and s.group_id = p_group_id
    and so.user_id = p_user_id;
end;
$$;

revoke execute on function _cleanup_departing_member(uuid, uuid) from public;
revoke execute on function _cleanup_departing_member(uuid, uuid) from authenticated;

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

  perform _cleanup_departing_member(p_group_id, p_target_user_id);

  update memberships set status = 'removed'
  where group_id = p_group_id and user_id = p_target_user_id;
end;
$$;

-- leave_group: the owner can't leave their own group (there's no ownership
-- transfer feature yet, and an ownerless group is a worse outcome than a
-- disabled button) — the UI hides "Leave" for the owner, and this is the
-- server-side backstop for that.
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

  perform _cleanup_departing_member(p_group_id, v_user_id);

  update memberships set status = 'removed'
  where group_id = p_group_id and user_id = v_user_id;
end;
$$;

revoke execute on function leave_group(uuid) from public;
grant execute on function leave_group(uuid) to authenticated;

-- Bug fix 2: guard the reseed loop against a stale/removed membership.
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
    raise exception 'invalid_operation: no season is in intermission — end the current season first';
  end if;

  update seasons
  set status = 'active', started_at = now(),
      seed_amount = v_settings.seed_amount, bet_cap_pct = v_settings.bet_cap_pct
  where id = v_season.id
  returning * into v_season;

  for rec in
    select so.user_id
    from season_optins so
    join memberships m on m.group_id = p_group_id and m.user_id = so.user_id
    where so.season_id = v_season.id and m.status <> 'removed'
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
    and user_id not in (select user_id from season_optins where season_id = v_season.id);

  return v_season;
end;
$$;
