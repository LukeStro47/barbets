-- Two fixes to get_member_stats prompted by _prune_resolved_system_markets() (20260830120000)
-- deleting old Sports/Weather markets (and their bets/ledger rows) out from under a member.
--
-- 1. net is reformulated as balance minus the seed ledger row(s), rather than summing every
--    non-seed row directly. These are mathematically identical -- balance always equals
--    sum(all ledger rows) for a membership, seed included, so balance - sum(seed rows) ==
--    sum(non-seed rows) exactly -- but the new form is immune to a pruned market's ledger rows
--    disappearing, since a seed row always has market_id null (ledger_seed_has_no_market_or_bet)
--    and is therefore never touched by the cascade pruning relies on. Applied for every group, not
--    just Sports/Weather: it's a strict improvement with no behavior change anywhere else.
-- 2. accuracy_pct/settled_bet_count/tokens_wagered/best_call_multiple/best_call_title all come
--    from live bets/markets joins, which pruning does erode over time -- unlike net, there's no
--    equivalent reformulation that survives a market's row actually being gone. Rather than let
--    those numbers silently shrink, a Sports/Weather membership (matched the same way
--    create_market's pipeline gate and _prune_resolved_system_markets itself identify these two
--    groups) gets null for all five instead, same as "not enough data yet" already renders
--    elsewhere. Every other group's stats are completely unaffected.
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
    select 1 from groups g where g.id = v_target.group_id and g.is_public and g.name in ('Sports', 'Weather')
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
