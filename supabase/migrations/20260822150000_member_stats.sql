-- get_member_stats: the foundation for viewing another member's profile.
--
-- Today, within a group, only you can see your own accuracy/net/bet history
-- — everyone else's is either invisible or (per the membership_ledger_net
-- design note) silently reads as a real-looking zero for other members. This
-- function is a deliberate, new authority decision: every active member's
-- performance record becomes visible to every other active member in the
-- same group, not just their own. See ARCHITECTURE.md's data model and
-- notable-decisions sections for the reasoning — this is not an extension of
-- an existing gate, it's a new one.
--
-- No new privacy exception for hidden-subject markets is needed: every stat
-- here is computed from bets on status = 'resolved' markets (or, for
-- tokens_wagered/settled_bet_count, from the bettor's own bet rows
-- regardless of market status), and a resolved market is already visible to
-- everyone per is_market_visible() — nothing here reveals a still-hidden
-- subject relationship that wasn't already surfaced at resolution.
--
-- The gate: the caller must be able to see this group's content at all
-- (_caller_is_active_group_member, which excludes both 'removed' and 'left'
-- — a member who left can't browse anyone's profile any more, same as every
-- other group surface). The *target* is allowed to be 'left' as well as
-- 'active'/'dormant' (only 'removed' is excluded), matching the leaderboard's
-- existing precedent of still showing a left member's honest historical
-- record if they actually played.
--
-- net is read directly from `ledger` under this function's elevated
-- privilege, deliberately closing the two known "silently reads zero for
-- other people" gaps membership_ledger_net's own-rows-only limitation left
-- behind (the removed weekly-trend line, and the departed-member check that
-- needed group_members_who_played instead) — this is the first place either
-- gap gets a real, deliberate answer rather than an accidental blind spot.
create function get_member_stats(p_membership_id uuid)
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
begin
  select * into v_target from memberships where id = p_membership_id;
  if v_target.id is null or v_target.status = 'removed' then
    raise exception 'not_found: member not found';
  end if;

  if not _caller_is_active_group_member(v_target.group_id) then
    raise exception 'not_found: member not found';
  end if;

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
    coalesce((select sum(l.amount) from ledger l where l.membership_id = p_membership_id and l.reason <> 'seed'), 0)::bigint,
    case when (select total from accuracy) > 0 then round(100.0 * (select correct from accuracy) / (select total from accuracy))::int else null end,
    (select count(distinct market_id) from settled)::int,
    (select total from wagered),
    (select multiple from best),
    (select title from best);
end;
$$;

revoke execute on function get_member_stats(uuid) from public;
grant execute on function get_member_stats(uuid) to authenticated;
