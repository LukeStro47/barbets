-- Two functions matched Sports/Weather by group name; both need NFL and CFB added now that Sports
-- has split into those two groups. Neither signature changes, so both are plain CREATE OR REPLACE.
--
-- _prune_resolved_system_markets(): identical to 20260830120000's version except the retention
-- count is no longer a flat 10 for every pipeline group. At one market a week, 10 would only be
-- about 10 weeks -- less than a season -- worth of NFL/CFB history staying browsable in the
-- group's own Settled tab; raised to 20 (roughly a full NFL season) for NFL/CFB specifically.
-- Weather keeps 10, unchanged -- it prunes daily-cadence markets, where 10 is already about a
-- week and a half.
create or replace function _prune_resolved_system_markets()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group record;
  v_market record;
  v_keep int;
begin
  for v_group in
    select id, name from groups where name in ('NFL', 'CFB', 'Weather') and is_public = true
  loop
    v_keep := case when v_group.name in ('NFL', 'CFB') then 20 else 10 end;

    for v_market in
      select id from markets
      where group_id = v_group.id
        and is_system_market = true
        and status in ('resolved', 'voided')
      order by resolved_at desc
      offset v_keep
    loop
      delete from markets where id = v_market.id;
    end loop;
  end loop;
end;
$$;

revoke execute on function _prune_resolved_system_markets() from public;
revoke execute on function _prune_resolved_system_markets() from authenticated;
grant execute on function _prune_resolved_system_markets() to service_role;

-- get_member_stats(): identical to 20260830130000's version except the pruned-pipeline-group
-- name list gains NFL and CFB alongside Weather -- see that migration's header comment for why
-- these groups' accuracy/wagered/best-call figures go null instead of silently eroding as old
-- markets age out of _prune_resolved_system_markets().
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
    select 1 from groups g where g.id = v_target.group_id and g.is_public and g.name in ('NFL', 'CFB', 'Weather')
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
    (v_target.balance - coalesce((select sum(l.amount) from ledger l where l.membership_id = p_membership_id and l.reason = 'seed'), 0))::bigint,
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
