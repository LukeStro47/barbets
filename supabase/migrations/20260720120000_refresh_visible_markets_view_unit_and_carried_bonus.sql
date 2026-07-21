-- Same bug, same fix, a third time: `visible_markets` is `select m.*`, and
-- Postgres freezes a view's column list at CREATE time — see
-- 20260708120000_refresh_visible_markets_view.sql and
-- 20260712110000_refresh_visible_markets_view_again.sql. Since that last
-- refresh, `unit` and `carried_bonus_pool` were both added to `markets`
-- (20260720100000/20260720110000) and have been silently missing from this
-- view ever since — breaking any query that explicitly selects them (the
-- group hub's market list errors outright rather than just missing a
-- column, which is why markets stopped showing up at all). CREATE OR
-- REPLACE VIEW is safe here for the same reason as before: only adding
-- trailing columns via `m.*`, nothing removed or retyped.
create or replace view visible_markets
with (security_invoker = true) as
select m.*
from markets m
where is_market_visible(m.id, auth.uid());

grant select on visible_markets to authenticated;
