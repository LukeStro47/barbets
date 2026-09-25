-- get_group_all_time_standings: 4r's real cross-member all-time table.
-- The leaderboard's existing "all time" tab only ever answered "what's my
-- own all-time net" (membership_ledger_net is own-rows-only via
-- ledger_select_own, so a caller reading another member's row silently gets
-- net = 0, entry_count = 0 -- a fake zero, not a real figure). Same class of
-- gap get_member_stats() already closed for a single member's profile page;
-- this is the batch form, for a whole group's ranked table at once, same
-- elevated-privilege reasoning.
--
-- Net formula matches get_member_stats() exactly: balance minus every
-- seed-reason ledger row, not a sum of everything else (see that function's
-- own migration comment / ARCHITECTURE.md's money section for why the two
-- are mathematically identical and the subtraction survives
-- _prune_resolved_system_markets()'s ledger cascade on old pipeline
-- markets, which a raw non-seed sum would not).
--
-- Eligibility mirrors the leaderboard page's own JS-side member set: every
-- active/dormant member, plus a `left` member only if they actually played
-- (a non-seed ledger row exists) -- a left member who never bet leaves no
-- trace here either, same as everywhere else in the app.
--
-- seasons_won counts season_results.snapshot->'champion'->>'user_id' across
-- every season this group has ever finished, per _finalize_season's own
-- champion JSON shape (jsonb_build_object('user_id', ...), confirmed against
-- its latest redeclaration rather than an earlier one -- see
-- ARCHITECTURE.md's note on why that matters for this function specifically).

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
      (e.balance - coalesce((select sum(l.amount) from ledger l where l.membership_id = e.id and l.reason = 'seed'), 0))::bigint as net
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
