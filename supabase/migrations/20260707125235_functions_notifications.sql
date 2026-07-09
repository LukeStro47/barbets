-- get_notification_recipients: the single choke point for push fan-out
-- (spec: "Notification fan-out excludes all subjects... write a test for
-- this"). Recipients are active (not dormant/removed) members with a push
-- subscription and notifications enabled, minus the market's subjects —
-- except for the 'resolved' event, where subjects are the whole point
-- ("the resolved push DOES go to subjects"), so p_include_subjects flips
-- that off.
--
-- Restricted to service_role only: this bypasses RLS (SECURITY DEFINER) and
-- returns other members' user_ids, so it must only ever be called from a
-- trusted server context (the Phase 6 Edge Function sending push, invoked
-- with the service role key) — never directly by an end user's own session,
-- which could otherwise use it to enumerate group membership or probe
-- subject status indirectly.
create or replace function get_notification_recipients(p_market_id uuid, p_include_subjects boolean default false)
returns table (user_id uuid)
language sql
stable
security definer
set search_path = public
as $$
  select distinct m.user_id
  from markets mk
  join memberships m on m.group_id = mk.group_id and m.status = 'active'
  join push_subscriptions ps on ps.user_id = m.user_id
  join users u on u.id = m.user_id and u.notifications_enabled = true
  where mk.id = p_market_id
    and (
      p_include_subjects
      or not exists (
        select 1 from market_subjects ms
        where ms.market_id = mk.id and ms.user_id = m.user_id
      )
    );
$$;

revoke execute on function get_notification_recipients(uuid, boolean) from public;
grant execute on function get_notification_recipients(uuid, boolean) to service_role;
