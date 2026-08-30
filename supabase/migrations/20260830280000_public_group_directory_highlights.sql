-- Widens list_public_groups() so the directory (and the groups hub's own "Open to anyone"
-- section) can show real signal per group — how much is open, and one thing to look at right
-- now — without a second round trip per group and without a client-side query against
-- markets/bets, which RLS (is_market_visible()) would silently zero out for a public group the
-- caller hasn't joined yet. list_public_groups() is already the one sanctioned open read for
-- this directory (see its own migration's comment); this just returns more of what it already
-- has full access to as SECURITY DEFINER, rather than opening a second hole.
--
-- Return type is changing (not just being widened via CREATE OR REPLACE), so this needs the
-- explicit DROP the project's function-change rule calls for — Postgres refuses to
-- CREATE OR REPLACE a function into a different RETURNS TABLE shape.
--
-- Deliberately does NOT return anything price/odds-shaped for the featured market: this app
-- never reveals odds on a market that's still open (see ARCHITECTURE.md's "sealed odds" design
-- decision), and a directory card is not an exception. featured_market_bet_count is fine to
-- expose the same way "N bets placed" already is on every open MarketCard/MarketRow — it's a
-- volume signal, not a pool split.
drop function list_public_groups();

create function list_public_groups()
returns table (
  id uuid,
  name text,
  avatar_key text,
  category text,
  member_count bigint,
  open_market_count bigint,
  featured_market_id uuid,
  featured_market_title text,
  featured_market_bet_count bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    g.id,
    g.name,
    g.avatar_key,
    g.category,
    (select count(*) from memberships m where m.group_id = g.id and m.status in ('active', 'dormant')),
    (select count(*) from markets mk where mk.group_id = g.id and mk.status = 'open'),
    fm.id,
    fm.title,
    (select count(*) from bets b where b.market_id = fm.id)
  from groups g
  -- The one open market to feature: soonest-closing first (the most time-sensitive thing to
  -- bet on), ties broken by newest, so a freshly created market wins over a stale one that
  -- happens to share a closes_at.
  left join lateral (
    select mk2.id, mk2.title
    from markets mk2
    where mk2.group_id = g.id and mk2.status = 'open'
    order by mk2.closes_at asc, mk2.created_at desc
    limit 1
  ) fm on true
  where g.is_public = true
    and g.deletion_scheduled_at is null
  order by g.category, g.name;
$$;

revoke execute on function list_public_groups() from public;
grant execute on function list_public_groups() to authenticated;
