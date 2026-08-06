-- Same bug class as 20260805141000_fix_subject_pulse_ambiguous_status.sql:
-- get_subject_market_pulse_for_group's RETURNS TABLE declares an output
-- column named `status`, which PL/pgSQL treats as an implicit variable in
-- scope for the whole function body — the bare `status` reference in the
-- membership check was genuinely ambiguous to Postgres, not just to a human
-- reader. Fixed by table-qualifying it the same way.
create or replace function get_subject_market_pulse_for_group(p_group_id uuid)
returns table (market_id uuid, status market_status, market_type market_type, closes_at timestamptz, bet_count bigint)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
begin
  perform 1 from memberships where group_id = p_group_id and user_id = v_user_id and memberships.status <> 'removed';
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
