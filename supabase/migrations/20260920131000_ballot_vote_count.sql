-- Sealed ballot progress (DESIGN 5k). Votes are RLS-hidden except the caller's own row
-- until are_votes_revealed() flips, so a plain `select count(*) from votes` under the
-- caller's session can only ever return 0 or 1 — never the real headcount. This SECURITY
-- DEFINER RPC returns only aggregate progress (plus whether the caller has voted), with
-- no names and no per-option tallies. Quorum / tie / turnout rules stay in finalize_market.

create or replace function get_ballot_progress(p_market_id uuid)
returns table (
  votes_cast int,
  eligible_voters int,
  closes_at timestamptz,
  has_voted boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_market markets%rowtype;
  v_challenge challenges%rowtype;
  v_window_hours numeric;
  v_votes_cast int;
  v_eligible int;
  v_has_voted boolean;
begin
  if v_user_id is null or not is_market_visible(p_market_id, v_user_id) then
    raise exception 'not_found: market not found';
  end if;

  select * into v_market from markets where id = p_market_id;
  if v_market.id is null then
    raise exception 'not_found: market not found';
  end if;

  -- Only meaningful on a live ballot. Same 404 for every other status so a closed
  -- market and a nonexistent one stay indistinguishable at this call site.
  if v_market.status <> 'disputed' then
    raise exception 'not_found: market not found';
  end if;

  select * into v_challenge from challenges where market_id = p_market_id;
  if v_challenge.id is null then
    raise exception 'not_found: market not found';
  end if;

  select resolution_window_hours into v_window_hours
  from group_settings
  where group_id = v_market.group_id;

  -- Mirrors cast_vote / finalize_market's eligible-voter definition exactly:
  -- non-removed members minus this market's subjects.
  select count(*)::int into v_eligible
  from memberships m
  where m.group_id = v_market.group_id
    and m.status <> 'removed'
    and not exists (
      select 1 from market_subjects ms
      where ms.market_id = p_market_id and ms.user_id = m.user_id
    );

  select count(distinct v.voter_id)::int into v_votes_cast
  from votes v
  where v.market_id = p_market_id;

  select exists (
    select 1 from votes v
    where v.market_id = p_market_id and v.voter_id = v_user_id
  ) into v_has_voted;

  votes_cast := coalesce(v_votes_cast, 0);
  eligible_voters := coalesce(v_eligible, 0);
  closes_at := v_challenge.created_at + (coalesce(v_window_hours, 8) * interval '1 hour');
  has_voted := coalesce(v_has_voted, false);
  return next;
end;
$$;

revoke execute on function get_ballot_progress(uuid) from public;
grant execute on function get_ballot_progress(uuid) to authenticated;
