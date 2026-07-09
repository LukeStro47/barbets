-- Bug fix: `visible_markets` is a `select m.*` view, and Postgres freezes a
-- view's column list at CREATE time — a later `alter table markets add
-- column ...` does NOT propagate into an existing view automatically. Two
-- of today's migrations added columns to markets (`closed_at` from the
-- early-close change, `outcome_option_id` from multiple choice) that were
-- silently missing from this view ever since, which:
--   - hard-errors ("column visible_markets.outcome_option_id does not
--     exist") for any query that explicitly selects a new column, and
--   - silently omits the new columns for any query using `select('*')`,
--     which is how the market detail/reveal pages read `closed_at` and
--     `outcome_option_id` — so "closed early by proposal" and the
--     multiple-choice reveal outcome were quietly broken too.
-- CREATE OR REPLACE VIEW is safe here because we're only ever *adding*
-- trailing columns via `m.*` picking up markets' current full column list —
-- no existing column is removed or retyped.
create or replace view visible_markets
with (security_invoker = true) as
select m.*
from markets m
where is_market_visible(m.id, auth.uid());

grant select on visible_markets to authenticated;
