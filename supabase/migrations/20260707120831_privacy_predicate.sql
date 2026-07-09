-- The single privacy choke point. Every RLS policy that gates access to a
-- market or anything hanging off one (market_subjects, bets, resolution
-- proposals, challenges, votes) calls this same function, so the rule
-- "member of the group AND (not a subject OR the market is resolved/voided)"
-- lives in exactly one place, per the spec's non-negotiable requirement.
--
-- SECURITY DEFINER + a fixed search_path so the inner joins bypass RLS on
-- markets/memberships/market_subjects entirely (avoiding any recursive
-- re-evaluation of the very policies this function backs) and can't be
-- hijacked by a caller-controlled search_path.
create or replace function is_market_visible(p_market_id uuid, p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from markets m
    join memberships mem
      on mem.group_id = m.group_id and mem.user_id = p_user_id
    where m.id = p_market_id
      and (
        not exists (
          select 1 from market_subjects ms
          where ms.market_id = m.id and ms.user_id = p_user_id
        )
        or m.status in ('resolved', 'voided')
      )
  );
$$;

revoke execute on function is_market_visible(uuid, uuid) from public;
grant execute on function is_market_visible(uuid, uuid) to authenticated;

-- Companion predicate for the resolution_proposals/challenges/votes ballot
-- reveal gate: a market's votes are visible once its (unique) proposal has
-- been tallied, independent of whether the market took the no-challenge fast
-- path (which never had a vote at all).
create or replace function are_votes_revealed(p_market_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from resolution_proposals rp
    where rp.market_id = p_market_id and rp.votes_revealed_at is not null
  );
$$;

revoke execute on function are_votes_revealed(uuid) from public;
grant execute on function are_votes_revealed(uuid) to authenticated;

-- The single choke point for reading markets. security_invoker = true is
-- mandatory here (Postgres 15+/Supabase): without it, the view would run
-- with its owner's privileges rather than the querying user's, which,
-- combined with is_market_visible() being SECURITY DEFINER, could silently
-- bypass the intent of RLS on markets for anyone merely granted SELECT on
-- this view. The WHERE clause here and the markets SELECT policy (next
-- migration) both call is_market_visible() — intentionally redundant, so
-- that even if one were ever dropped by mistake, the other still enforces
-- the same rule.
create or replace view visible_markets
with (security_invoker = true) as
select m.*
from markets m
where is_market_visible(m.id, auth.uid());

grant select on visible_markets to authenticated;
