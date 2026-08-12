-- Wraps every `auth.uid()` reached from an RLS policy as `(select auth.uid())`.
--
-- A bare `auth.uid()` in a USING/WITH CHECK expression is a function reference
-- sitting inside a per-row filter, so Postgres calls it once for every row it
-- tests. Wrapping it in a scalar subquery makes it an uncorrelated InitPlan
-- instead: evaluated once for the whole statement and reused. On the tables
-- where it hurts most here (bets, and everything gated by is_market_visible)
-- that is the difference between one JWT decode and one per row. Nothing about
-- who can see what changes; these are the same predicates, re-parenthesized.
--
-- ALTER POLICY, not DROP + CREATE. Two reasons, one of which is not obvious:
--
--   * A rewrite only has to restate the expression, so the command and the
--     role list can't drift as a side effect of a performance change.
--
--   * More importantly, the `create policy` statements in this migration
--     history are NOT the current definitions. Six policies (groups,
--     group_settings, memberships, seasons, season_optins, season_results)
--     were rewritten in place by 20260707131619_phase3_security_fixes.sql to
--     call `_caller_is_active_group_member()` instead of their original
--     inline EXISTS-on-memberships, because the original memberships_select
--     recursed into itself and raised 42P17 on every read that touched the
--     table. Reconstructing those policies from their `create policy` text
--     would silently reintroduce that bug AND drop the `status not in
--     ('removed', 'left')` filter the helper has since grown, handing a left
--     member their old group back. Read pg_policies, not the migrations, before
--     touching any policy in this project.
--
-- What is deliberately NOT touched:
--
--   * Those same six, plus season_optouts_select. Their only auth.uid() is
--     inside `_caller_is_active_group_member()`, which is SECURITY DEFINER and
--     therefore never inlined into the query, so there is no expression here to
--     hoist. Wrapping would mean copying that function's membership rule into
--     seven policies, and that rule drifting is a privacy bug, not a
--     performance one.
--
--   * users_select_all, which is `using (true)`.
--
-- The other shape needing care: the `is_market_visible(...)` policies never
-- wrote `auth.uid()` at all. They relied on the function's `p_user_id uuid
-- default auth.uid()`, which is inlined into the query as a bare per-row call
-- exactly as if it had been written out - invisible to any audit that greps
-- policy text. That default cannot itself be wrapped (Postgres rejects a
-- subquery in a parameter default outright), so each policy now passes the
-- wrapped value explicitly. The default stays for any non-policy caller.

-- Bare auth.uid() in the policy expression -------------------------------
alter policy users_insert_own on users
  with check (id = (select auth.uid()));

alter policy ledger_select_own on ledger
  using (
    exists (
      select 1 from memberships m
      where m.id = ledger.membership_id and m.user_id = (select auth.uid())
    )
  );

alter policy group_titles_select on group_titles
  using (
    exists (
      select 1 from memberships m
      where m.group_id = group_titles.group_id and m.user_id = (select auth.uid())
    )
  );

alter policy push_subscriptions_all_own on push_subscriptions
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- auth.uid() reached through is_market_visible's parameter default -------
alter policy markets_select on markets
  using (is_market_visible(id, (select auth.uid())));

alter policy market_subjects_select on market_subjects
  using (is_market_visible(market_id, (select auth.uid())));

alter policy market_options_select on market_options
  using (is_market_visible(market_id, (select auth.uid())));

alter policy market_reactions_select on market_reactions
  using (is_market_visible(market_id, (select auth.uid())));

alter policy resolution_proposals_select on resolution_proposals
  using (is_market_visible(market_id, (select auth.uid())));

alter policy challenges_select on challenges
  using (is_market_visible(market_id, (select auth.uid())));

alter policy resolution_clarifications_select on resolution_clarifications
  using (is_market_visible(market_id, (select auth.uid())));

-- Both shapes at once ---------------------------------------------------
-- Own bets are always visible to the bettor (needed for the "sealed" open
-- market UI). Other members' individual bets only become visible once the
-- market is resolved or voided.
alter policy bets_select on bets
  using (
    user_id = (select auth.uid())
    or (
      is_market_visible(market_id, (select auth.uid()))
      and exists (
        select 1 from markets m
        where m.id = bets.market_id and m.status in ('resolved', 'voided')
      )
    )
  );

-- The secret ballot: a voter can always see their own vote, but nobody's vote
-- is visible in aggregate until are_votes_revealed() flips true at tally time.
alter policy votes_select on votes
  using (
    voter_id = (select auth.uid())
    or (is_market_visible(market_id, (select auth.uid())) and are_votes_revealed(market_id))
  );

-- The view is the same per-row call in a fourth guise: `select m.*` over
-- markets with is_market_visible(m.id, auth.uid()) in the WHERE.
-- security_invoker stays load-bearing (without it the view would run as its
-- owner, not the querying user).
--
-- CREATE OR REPLACE VIEW re-expands `m.*` against the current markets table,
-- which is the documented reason this view has had to be refreshed three times
-- already (20260708120000 / 20260712110000 / 20260720120000): Postgres freezes
-- a view's column list at CREATE time. `closing_nudge_sent_at` (20260810162000)
-- has been missing from it since, and picking it up here is safe for the same
-- reason as every previous refresh: only trailing columns are added, nothing is
-- dropped or retyped.
create or replace view visible_markets
with (security_invoker = true) as
select m.*
from markets m
where is_market_visible(m.id, (select auth.uid()));

grant select on visible_markets to authenticated;
