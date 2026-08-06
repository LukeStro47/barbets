-- List variant of get_subject_market_pulse, scoped to a whole group instead
-- of a single market — powers a "???" teaser row per hidden-subject market
-- in the group feed. Mirrors get_subject_market_pulse's own checks exactly
-- (real member of the group, an actual subject of each market, not yet
-- resolved/voided) but as a set. Deliberately not built on
-- is_market_visible() — that function's whole purpose is to say no here,
-- same reasoning ARCHITECTURE.md gives for get_subject_market_pulse itself.
-- A resolved/voided subject market is already fully visible via
-- visible_markets, so it's excluded here to avoid showing it twice.
-- Scope-cut: excludes pending_sponsor (no real activity yet, and would need
-- created_at plumbing this teaser doesn't otherwise need).
create function get_subject_market_pulse_for_group(p_group_id uuid)
returns table (market_id uuid, status market_status, market_type market_type, closes_at timestamptz, bet_count bigint)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
begin
  perform 1 from memberships where group_id = p_group_id and user_id = v_user_id and status <> 'removed';
  if not found then
    raise exception 'not_found: group not found';
  end if;

  return query
  select m.id, m.status, m.market_type, m.closes_at, count(b.id)
  from markets m
  join market_subjects ms on ms.market_id = m.id and ms.user_id = v_user_id
  left join bets b on b.market_id = m.id
  where m.group_id = p_group_id
    and m.status in ('open', 'closed', 'proposed', 'disputed')
  group by m.id, m.status, m.market_type, m.closes_at;
end;
$$;

revoke execute on function get_subject_market_pulse_for_group(uuid) from public;
grant execute on function get_subject_market_pulse_for_group(uuid) to authenticated;
