-- Same bug, same fix, again: `visible_markets` is `select m.*`, and Postgres
-- freezes a view's column list at CREATE time — see
-- 20260708120000_refresh_visible_markets_view.sql, the first time this bit
-- the project. Since that refresh, `bonus_pool` and `payout_breakdown` were
-- both added to `markets` and have been silently missing from this view
-- (and therefore from every page that reads a market via `select('*')` from
-- it) ever since. CREATE OR REPLACE VIEW is safe here for the same reason
-- as last time: only adding trailing columns via `m.*`, nothing removed or
-- retyped.
create or replace view visible_markets
with (security_invoker = true) as
select m.*
from markets m
where is_market_visible(m.id, auth.uid());

grant select on visible_markets to authenticated;
