-- end_season: owner-only. Voids+refunds every non-terminal market in the
-- ending season, snapshots final standings into season_results, archives
-- the season, and opens a fresh 'intermission' row for the next one (the
-- row season_optins reference while the group waits for the owner to start
-- it — see join_group()/opt_in_season() for how members get attached to it).
--
-- "Champion", "biggest single win", and "worst beat" aren't defined
-- precisely by the spec; this uses the most literal reasonable reading:
-- champion = highest final balance, biggest single win = the largest
-- single payout ledger entry, worst beat = the largest-stake bet that
-- ended up losing (payout = 0). Documented here since it's an
-- interpretation, not a spec quote.
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
      select jsonb_build_object('user_id', m.user_id, 'username', u.username, 'balance', m.balance)
      from memberships m join users u on u.id = m.user_id
      where m.group_id = p_group_id and m.status <> 'removed'
      order by m.balance desc, m.user_id
      limit 1
    ),
    'final_balances', (
      select coalesce(
        jsonb_agg(jsonb_build_object('user_id', m.user_id, 'username', u.username, 'balance', m.balance) order by m.balance desc),
        '[]'::jsonb
      )
      from memberships m join users u on u.id = m.user_id
      where m.group_id = p_group_id and m.status <> 'removed'
    ),
    'biggest_single_win', (
      select jsonb_build_object('user_id', u.id, 'username', u.username, 'amount', l.amount, 'market_id', l.market_id)
      from ledger l
      join memberships m on m.id = l.membership_id
      join users u on u.id = m.user_id
      where m.group_id = p_group_id and l.reason = 'payout' and l.created_at >= v_season.started_at
      order by l.amount desc
      limit 1
    ),
    'worst_beat', (
      select jsonb_build_object('user_id', u.id, 'username', u.username, 'amount', b.amount, 'market_id', b.market_id)
      from bets b
      join markets mk on mk.id = b.market_id
      join users u on u.id = b.user_id
      where mk.group_id = p_group_id and mk.season_id = v_season.id and b.payout = 0
      order by b.amount desc
      limit 1
    )
  ) into v_snapshot;

  insert into season_results (group_id, season_id, snapshot)
  values (p_group_id, v_season.id, v_snapshot);

  update seasons set status = 'archived', ended_at = now() where id = v_season.id;

  select coalesce(max(number), 0) + 1 into v_next_number from seasons where group_id = p_group_id;

  insert into seasons (group_id, number, status)
  values (p_group_id, v_next_number, 'intermission');
end;
$$;

revoke execute on function end_season(uuid) from public;
grant execute on function end_season(uuid) to authenticated;

-- start_season: owner-only, requires an 'intermission' season row to exist
-- (created by end_season()). Snapshots the group's *current* settings at
-- this exact moment — any edits made during intermission are captured here,
-- matching "changes take effect at the next season". Opted-in members are
-- reseeded and activated; everyone else (didn't opt in) goes/stays dormant.
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
    select user_id from season_optins where season_id = v_season.id
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

revoke execute on function start_season(uuid) from public;
grant execute on function start_season(uuid) to authenticated;

-- opt_in_season: idempotent (on conflict do nothing). If the target season
-- has already started (late opt-in, after start_season() already ran),
-- reseed and activate immediately rather than waiting for a start_season()
-- call that won't happen again for this season.
create or replace function opt_in_season(p_season_id uuid)
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
  if v_season.status not in ('intermission', 'active') then
    raise exception 'invalid_operation: this season is no longer accepting opt-ins';
  end if;

  perform 1 from memberships
  where group_id = v_season.group_id and user_id = v_user_id and status <> 'removed';
  if not found then
    raise exception 'not_found: not a member of this group';
  end if;

  insert into season_optins (season_id, user_id)
  values (p_season_id, v_user_id)
  on conflict do nothing;

  get diagnostics v_row_count = row_count;

  if v_season.status = 'active' and v_row_count > 0 then
    update memberships
    set status = 'active', balance = v_season.seed_amount
    where group_id = v_season.group_id and user_id = v_user_id;

    insert into ledger (membership_id, amount, reason)
    select id, v_season.seed_amount, 'seed'
    from memberships where group_id = v_season.group_id and user_id = v_user_id;
  end if;
end;
$$;

revoke execute on function opt_in_season(uuid) from public;
grant execute on function opt_in_season(uuid) to authenticated;
