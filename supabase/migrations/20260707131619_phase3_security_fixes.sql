-- Two real bugs surfaced by the Phase 3 integration tests, both fixed here.

-- 1. INFINITE RECURSION: memberships_select's USING clause queried
-- memberships from within a policy ON memberships itself ("mine" subquery).
-- Evaluating that policy for ANY row requires re-evaluating the same
-- policy for the inner subquery's rows, forever — Postgres detects this
-- and errors with 42P17 on every single read that touches memberships,
-- including transitively (e.g. reading ledger, which joins memberships).
-- Fix: move the check into a SECURITY DEFINER function, whose internal
-- query bypasses RLS entirely (same technique as is_market_visible()), so
-- there's no self-referential policy evaluation.
create or replace function _caller_is_active_group_member(p_group_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from memberships
    where group_id = p_group_id and user_id = auth.uid() and status <> 'removed'
  );
$$;

revoke execute on function _caller_is_active_group_member(uuid) from public;
grant execute on function _caller_is_active_group_member(uuid) to authenticated;

alter policy groups_select on groups using (
  _caller_is_active_group_member(groups.id)
);

alter policy group_settings_select on group_settings using (
  _caller_is_active_group_member(group_settings.group_id)
);

alter policy memberships_select on memberships using (
  _caller_is_active_group_member(memberships.group_id)
);

alter policy seasons_select on seasons using (
  _caller_is_active_group_member(seasons.group_id)
);

alter policy season_optins_select on season_optins using (
  exists (
    select 1 from seasons s
    where s.id = season_optins.season_id and _caller_is_active_group_member(s.group_id)
  )
);

alter policy season_results_select on season_results using (
  _caller_is_active_group_member(season_results.group_id)
);

-- 2. OVER-PERMISSIVE GRANTS: this Supabase project has a default privilege
-- that grants EXECUTE on newly created functions to `authenticated`
-- automatically, independent of PUBLIC. Every migration so far only ran
-- `revoke ... from public`, which does not touch that direct grant — so
-- functions meant to be internal-only (money-movement helpers with no
-- caller-eligibility checks, and the cron/notification entry points) were
-- actually callable by any logged-in user. Confirmed by a Phase 3 test
-- that successfully called get_notification_recipients() as an ordinary
-- member. Explicitly revoking from `authenticated` (not just `public`)
-- closes this for every internal-only function.
revoke execute on function refund_all_bets(uuid) from authenticated;
revoke execute on function _void_market(uuid) from authenticated;
revoke execute on function _refund_single_bet(uuid) from authenticated;
revoke execute on function expire_stale() from authenticated;
revoke execute on function get_notification_recipients(uuid, boolean) from authenticated;
