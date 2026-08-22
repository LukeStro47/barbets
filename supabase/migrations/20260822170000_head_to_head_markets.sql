-- get_head_to_head_markets: the second half of head-to-head analysis, built
-- on the same authority decision get_member_stats() already made — every
-- active member can see every other active (or left-but-played) member's
-- record within a shared group. This adds no new disclosure beyond that:
-- every row here comes from status = 'resolved' bets/markets, already
-- visible to everyone per is_market_visible() once a market resolves.
--
-- Aggregated per (market, user) rather than joined bet-by-bet, so a hedged
-- bettor (allow_hedged_bets is opt-out, not the exception) collapses to one
-- row per market instead of a cross-joined fan-out of every side/option
-- combination the two of them happened to hold. "choice" is resolved to a
-- plain label in SQL (the side text, or the option's label for multiple
-- choice) rather than an enum/uuid the client would have to look up itself.
create function get_head_to_head_markets(p_membership_id_a uuid, p_membership_id_b uuid)
returns table (
  market_id uuid,
  title text,
  resolved_at timestamptz,
  a_amount bigint,
  a_payout bigint,
  a_choice text,
  b_amount bigint,
  b_payout bigint,
  b_choice text
)
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_a memberships%rowtype;
  v_b memberships%rowtype;
begin
  select * into v_a from memberships where id = p_membership_id_a;
  select * into v_b from memberships where id = p_membership_id_b;

  if v_a.id is null or v_b.id is null or v_a.status = 'removed' or v_b.status = 'removed' then
    raise exception 'not_found: member not found';
  end if;

  if v_a.group_id <> v_b.group_id then
    raise exception 'not_found: member not found';
  end if;

  if not _caller_is_active_group_member(v_a.group_id) then
    raise exception 'not_found: member not found';
  end if;

  return query
  with a_bets as (
    select b.market_id, sum(b.amount)::bigint as amount, sum(b.payout)::bigint as payout,
           (array_agg(coalesce(mo.label, b.side::text) order by b.amount desc))[1] as choice
    from bets b
    left join market_options mo on mo.id = b.option_id
    where b.user_id = v_a.user_id
    group by b.market_id
  ),
  b_bets as (
    select b.market_id, sum(b.amount)::bigint as amount, sum(b.payout)::bigint as payout,
           (array_agg(coalesce(mo.label, b.side::text) order by b.amount desc))[1] as choice
    from bets b
    left join market_options mo on mo.id = b.option_id
    where b.user_id = v_b.user_id
    group by b.market_id
  )
  select m.id, m.title, m.resolved_at, a.amount, a.payout, a.choice, b.amount, b.payout, b.choice
  from markets m
  join a_bets a on a.market_id = m.id
  join b_bets b on b.market_id = m.id
  where m.group_id = v_a.group_id and m.status = 'resolved'
  order by m.resolved_at desc;
end;
$$;

revoke execute on function get_head_to_head_markets(uuid, uuid) from public;
grant execute on function get_head_to_head_markets(uuid, uuid) to authenticated;
