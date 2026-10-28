-- All-time net was wrong for anyone who had played more than one season.
--
-- get_member_stats() and get_group_all_time_standings() both computed net as
-- `balance - sum(seed rows)`, which relies on balance always equalling the sum
-- of every ledger row. A new season breaks that: _start_season sets
-- `balance = seed_amount` outright and writes one new seed row, with nothing in
-- the ledger for the old season's leftover balance it just overwrote. So each
-- extra season subtracted one more seed from the result: a member who had
-- never bet across two seasons showed -1,000, and every earlier season's real
-- result was dropped on the floor.
--
-- The plain alternative, summing every non-seed row (membership_ledger_net's
-- definition), is right across seasons but not for the NFL/CFB pipeline
-- groups, whose old market ledger rows _prune_resolved_system_markets()
-- deletes. Those groups force seasons off, so their memberships have exactly
-- one seed row, which is exactly when the subtraction is still correct. Hence
-- the split: one seed row, subtract; more than one, sum the non-seed rows.
-- No group with more than one seed row is ever pruned.

create or replace function _membership_all_time_net(p_membership_id uuid)
returns bigint
language sql
stable
set search_path = public
as $$
  select case
    when (select count(*) from ledger l where l.membership_id = p_membership_id and l.reason = 'seed') > 1
      then (select coalesce(sum(l.amount), 0) from ledger l where l.membership_id = p_membership_id and l.reason <> 'seed')
    else (select m.balance from memberships m where m.id = p_membership_id)
       - (select coalesce(sum(l.amount), 0) from ledger l where l.membership_id = p_membership_id and l.reason = 'seed')
  end::bigint;
$$;

-- Internal: only ever called from the SECURITY DEFINER functions below, which
-- do their own membership gating first. Reading another member's net directly
-- would bypass that.
revoke execute on function _membership_all_time_net(uuid) from public;
revoke execute on function _membership_all_time_net(uuid) from anon;
revoke execute on function _membership_all_time_net(uuid) from authenticated;

-- get_member_stats(): identical to 20260912091138's version except for net.
create or replace function get_member_stats(p_membership_id uuid)
returns table (
  membership_id uuid,
  group_id uuid,
  user_id uuid,
  nickname citext,
  balance int,
  joined_at timestamptz,
  net bigint,
  accuracy_pct int,
  settled_bet_count int,
  tokens_wagered bigint,
  best_call_multiple numeric,
  best_call_title text
)
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_target memberships%rowtype;
  v_is_pruned_pipeline_group boolean;
begin
  select * into v_target from memberships where id = p_membership_id;
  if v_target.id is null or v_target.status = 'removed' then
    raise exception 'not_found: member not found';
  end if;

  if not _caller_is_active_group_member(v_target.group_id) then
    raise exception 'not_found: member not found';
  end if;

  select exists (
    select 1 from groups g where g.id = v_target.group_id and g.is_public and g.name in ('NFL', 'CFB')
  ) into v_is_pruned_pipeline_group;

  return query
  with resolved_bets as (
    select b.side, b.option_id, m.outcome, m.outcome_option_id
    from bets b
    join markets m on m.id = b.market_id
    where b.user_id = v_target.user_id and m.group_id = v_target.group_id and m.status = 'resolved'
  ),
  settled as (
    select b.market_id, b.amount, b.payout, mk.title
    from bets b
    join markets mk on mk.id = b.market_id
    where b.user_id = v_target.user_id and mk.group_id = v_target.group_id and b.settled_at is not null
  ),
  wagered as (
    select coalesce(sum(b.amount), 0)::bigint as total
    from bets b
    join markets mk on mk.id = b.market_id
    where b.user_id = v_target.user_id and mk.group_id = v_target.group_id
  ),
  best as (
    select (payout::numeric / amount) as multiple, title
    from settled
    where payout is not null and payout > amount
    order by (payout::numeric / amount) desc
    limit 1
  ),
  accuracy as (
    select
      count(*) as total,
      count(*) filter (
        where (option_id is not null and option_id = outcome_option_id)
           or (option_id is null and outcome is not null and side::text = outcome::text)
      ) as correct
    from resolved_bets
  )
  select
    v_target.id,
    v_target.group_id,
    v_target.user_id,
    v_target.nickname,
    v_target.balance,
    v_target.joined_at,
    _membership_all_time_net(p_membership_id),
    case when v_is_pruned_pipeline_group then null
         when (select total from accuracy) > 0 then round(100.0 * (select correct from accuracy) / (select total from accuracy))::int
         else null end,
    case when v_is_pruned_pipeline_group then null else (select count(distinct market_id) from settled)::int end,
    case when v_is_pruned_pipeline_group then null else (select total from wagered) end,
    case when v_is_pruned_pipeline_group then null else (select multiple from best) end,
    case when v_is_pruned_pipeline_group then null else (select title from best) end;
end;
$$;

revoke execute on function get_member_stats(uuid) from public;
grant execute on function get_member_stats(uuid) to authenticated;

-- get_group_all_time_standings(): identical to 20260925100000's version except for net.
create or replace function get_group_all_time_standings(p_group_id uuid)
returns table (
  user_id uuid,
  nickname citext,
  net bigint,
  seasons_won int
)
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  if not _caller_is_active_group_member(p_group_id) then
    raise exception 'not_found: group not found';
  end if;

  return query
  with eligible as (
    select m.id, m.user_id, m.nickname, m.balance
    from memberships m
    where m.group_id = p_group_id
      and (
        m.status in ('active', 'dormant')
        or (
          m.status = 'left'
          and exists (select 1 from ledger l where l.membership_id = m.id and l.reason <> 'seed')
        )
      )
  ),
  nets as (
    select
      e.user_id,
      e.nickname,
      _membership_all_time_net(e.id) as net
    from eligible e
  ),
  wins as (
    select (sr.snapshot -> 'champion' ->> 'user_id')::uuid as user_id, count(*) as seasons_won
    from season_results sr
    where sr.group_id = p_group_id and sr.snapshot -> 'champion' ->> 'user_id' is not null
    group by 1
  )
  select n.user_id, n.nickname, n.net, coalesce(w.seasons_won, 0)::int
  from nets n
  left join wins w on w.user_id = n.user_id
  order by n.net desc, n.user_id;
end;
$$;

revoke execute on function get_group_all_time_standings(uuid) from public;
revoke execute on function get_group_all_time_standings(uuid) from anon;
grant execute on function get_group_all_time_standings(uuid) to authenticated;
