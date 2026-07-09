-- create_group/join_group now require a p_nickname on any path that
-- creates a brand-new membership row (the owner's own row in create_group;
-- either new-membership branch in join_group). Reactivating a dormant row
-- or no-op'ing on an already-active one ignores the parameter entirely —
-- that membership already has a nickname from when it was first created.
--
-- Both old (shorter) signatures are dropped first: adding a new trailing
-- default parameter does not replace the old overload in Postgres (a
-- function's identity is its argument *type* signature, defaults
-- notwithstanding) — the same lesson today's multiple-choice work already
-- hit once with place_bet/create_market/propose_resolution/cast_vote.
drop function if exists create_group(text, int, int, boolean, season_length);
drop function if exists join_group(text);

create or replace function create_group(
  p_name text,
  p_seed_amount int,
  p_bet_cap_pct int,
  p_seasons_enabled boolean default false,
  p_season_length season_length default null,
  p_nickname citext default null
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

  if p_nickname is null or trim(p_nickname::text) = '' then
    raise exception 'invalid_operation: choose a nickname to create a group with';
  end if;
  if p_nickname::text !~ '^[A-Za-z0-9_]{1,20}$' then
    raise exception 'invalid_operation: nicknames can only use letters, numbers, and underscores, up to 20 characters';
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

  insert into memberships (group_id, user_id, balance, status, nickname)
  values (v_group.id, v_user_id, p_seed_amount, 'active', p_nickname)
  returning id into v_membership_id;

  insert into ledger (membership_id, amount, reason)
  values (v_membership_id, p_seed_amount, 'seed');

  return v_group;
end;
$$;

revoke execute on function create_group(text, int, int, boolean, season_length, citext) from public;
grant execute on function create_group(text, int, int, boolean, season_length, citext) to authenticated;

create or replace function join_group(p_invite_code text, p_nickname citext default null)
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

  -- Only a genuinely new membership reaches here — needs a nickname.
  if p_nickname is null or trim(p_nickname::text) = '' then
    raise exception 'invalid_operation: choose a nickname to join with';
  end if;
  if p_nickname::text !~ '^[A-Za-z0-9_]{1,20}$' then
    raise exception 'invalid_operation: nicknames can only use letters, numbers, and underscores, up to 20 characters';
  end if;
  perform 1 from memberships where group_id = v_group.id and nickname = p_nickname and status <> 'removed';
  if found then
    raise exception 'invalid_operation: that nickname is already taken in this group';
  end if;

  select * into v_settings from group_settings where group_id = v_group.id;

  if v_settings.seasons_enabled then
    select * into v_active_season from seasons where group_id = v_group.id and status = 'active';
  end if;

  if v_settings.seasons_enabled and v_active_season.id is null then
    select * into v_intermission_season from seasons where group_id = v_group.id and status = 'intermission';

    insert into memberships (group_id, user_id, balance, status, nickname)
    values (v_group.id, v_user_id, 0, 'dormant', p_nickname)
    returning * into v_membership;

    if v_intermission_season.id is not null then
      insert into season_optins (season_id, user_id)
      values (v_intermission_season.id, v_user_id)
      on conflict do nothing;
    end if;

    return v_membership;
  end if;

  v_seed := case when v_settings.seasons_enabled then v_active_season.seed_amount else v_settings.seed_amount end;

  insert into memberships (group_id, user_id, balance, status, nickname)
  values (v_group.id, v_user_id, v_seed, 'active', p_nickname)
  returning * into v_membership;

  insert into ledger (membership_id, amount, reason)
  values (v_membership.id, v_seed, 'seed');

  return v_membership;
end;
$$;

revoke execute on function join_group(text, citext) from public;
grant execute on function join_group(text, citext) to authenticated;

-- update_nickname: a member can fix a typo or just change their mind later.
-- Same format/uniqueness rules as joining, minus the group-existence dance
-- since the caller is already a member.
create or replace function update_nickname(p_group_id uuid, p_nickname citext)
returns memberships
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_membership memberships%rowtype;
begin
  select * into v_membership from memberships where group_id = p_group_id and user_id = v_user_id and status <> 'removed' for update;
  if v_membership.id is null then
    raise exception 'not_found: not a member of this group';
  end if;

  if p_nickname is null or trim(p_nickname::text) = '' then
    raise exception 'invalid_operation: choose a nickname';
  end if;
  if p_nickname::text !~ '^[A-Za-z0-9_]{1,20}$' then
    raise exception 'invalid_operation: nicknames can only use letters, numbers, and underscores, up to 20 characters';
  end if;

  perform 1 from memberships where group_id = p_group_id and nickname = p_nickname and status <> 'removed' and user_id <> v_user_id;
  if found then
    raise exception 'invalid_operation: that nickname is already taken in this group';
  end if;

  update memberships set nickname = p_nickname where id = v_membership.id returning * into v_membership;
  return v_membership;
end;
$$;

revoke execute on function update_nickname(uuid, citext) from public;
grant execute on function update_nickname(uuid, citext) to authenticated;

-- end_season: the Hall of Fame snapshot now reads 'nickname' straight off
-- memberships (which already has group_id), dropping the join to users
-- entirely for the memberships-rooted parts of the snapshot. worst_beat is
-- rooted at bets/markets, so it still needs a join, just to memberships
-- (keyed on group_id + user_id) instead of the global users table.
create or replace function end_season(p_group_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_group groups%rowtype;
  v_season seasons%rowtype;
  v_next_number int;
  v_snapshot jsonb;
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
    raise exception 'forbidden: only the group owner can end the season';
  end if;

  select * into v_season from seasons where group_id = p_group_id and status = 'active' for update;
  if v_season.id is null then
    raise exception 'invalid_operation: no active season to end';
  end if;

  for rec in
    select id from markets
    where season_id = v_season.id and status not in ('resolved', 'voided')
    for update
  loop
    perform _void_market(rec.id);
  end loop;

  select jsonb_build_object(
    'champion', (
      select jsonb_build_object('user_id', m.user_id, 'nickname', m.nickname, 'balance', m.balance)
      from memberships m
      where m.group_id = p_group_id and m.status <> 'removed'
      order by m.balance desc, m.user_id
      limit 1
    ),
    'final_balances', (
      select coalesce(
        jsonb_agg(jsonb_build_object('user_id', m.user_id, 'nickname', m.nickname, 'balance', m.balance) order by m.balance desc),
        '[]'::jsonb
      )
      from memberships m
      where m.group_id = p_group_id and m.status <> 'removed'
    ),
    'biggest_single_win', (
      select jsonb_build_object('user_id', m.user_id, 'nickname', m.nickname, 'amount', l.amount, 'market_id', l.market_id)
      from ledger l
      join memberships m on m.id = l.membership_id
      where m.group_id = p_group_id and l.reason = 'payout' and l.created_at >= v_season.started_at
      order by l.amount desc
      limit 1
    ),
    'worst_beat', (
      select jsonb_build_object('user_id', m2.user_id, 'nickname', m2.nickname, 'amount', b.amount, 'market_id', b.market_id)
      from bets b
      join markets mk on mk.id = b.market_id
      join memberships m2 on m2.group_id = mk.group_id and m2.user_id = b.user_id
      where mk.group_id = p_group_id and mk.season_id = v_season.id and b.payout = 0
      order by b.amount desc
      limit 1
    )
  ) into v_snapshot;

  insert into season_results (group_id, season_id, snapshot)
  values (p_group_id, v_season.id, v_snapshot);

  update seasons set status = 'archived', ended_at = now() where id = v_season.id;

  perform _emit_notification_event('season_ended', p_group_id, null, v_season.id, v_caller);

  select coalesce(max(number), 0) + 1 into v_next_number from seasons where group_id = p_group_id;

  insert into seasons (group_id, number, status)
  values (p_group_id, v_next_number, 'intermission');
end;
$$;

revoke execute on function end_season(uuid) from public;
grant execute on function end_season(uuid) to authenticated;
