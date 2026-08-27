-- Data-only backfill, no function changes. _finalize_season() only started writing
-- markets_settled/tokens_wagered/bets_placed into season_results.snapshot as of
-- 20260823140000_season_end_stats_and_title_snapshot.sql. Every season_results row written
-- before that migration was applied is missing those keys entirely, so the UI's
-- `snapshot.markets_settled ?? 0` silently renders "All 0 from this season" (and the same 0 on
-- the /seasons archive) even though the season's markets are still sitting right there in the
-- markets table. bets/markets rows are never edited after a market resolves, so the same
-- season-scoped counts _finalize_season computes live can be recomputed exactly for old rows
-- too. titles_snapshot is deliberately not backfilled here: it's meant to capture group_titles
-- as they stood the moment that season closed, and today's group_titles is not that, so a
-- backfilled value would just be quietly wrong instead of honestly missing.
update season_results sr
set snapshot = sr.snapshot || jsonb_build_object(
  'markets_settled', (
    select count(*) from markets where season_id = sr.season_id and status in ('resolved', 'voided')
  ),
  'tokens_wagered', (
    select coalesce(sum(b.amount), 0)
    from bets b
    join markets mk on mk.id = b.market_id
    where mk.season_id = sr.season_id
  ),
  'bets_placed', (
    select count(*)
    from bets b
    join markets mk on mk.id = b.market_id
    where mk.season_id = sr.season_id
  )
)
where not (sr.snapshot ? 'markets_settled');
