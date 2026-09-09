-- 7-day login reward (GitHub #92). Open the app seven days in a row (in your own local day)
-- and claim a small pile of chips in every group you're an active member of.
--
-- Pieces, in order:
--   1. group_settings.login_reward_amount -- per-group reward. NULL = "5% of seed_amount,
--      computed at claim time" (so it tracks the allocation if the owner changes it), 0 = off,
--      anything else = an explicit figure the owner chose.
--   2. login_streaks -- one row per user, zero-policy (RPC-only), cascades with the user.
--   3. ledger CHECK constraints widened so a 'reward' row (positive, no market, no bet) fits.
--   4. notification_events.group_id becomes nullable for the one user-scoped event type,
--      with a CHECK that keeps every other type group-bound as before.
--   5. _record_app_open() (the streak state machine, service_role-only so tests can drive a
--      backdated week), record_app_open() (the client entry point: same thing behind a +/-1 day
--      clamp on the submitted local day), claim_login_reward(), get_login_reward_status(),
--      get_group_login_streaks(), and the shared _login_reward_amount() formula.
--   6. _notification_category / get_event_recipients: carried forward from 20260828130000 in
--      full, plus the login_reward_ready mapping and recipient branch.
--
-- update_group_settings() gets its new parameter in the next migration (signature change =>
-- DROP FUNCTION first), kept separate so this file stays readable.

-- 1. Per-group reward amount. Nullable on purpose -- see the header.
alter table group_settings add column login_reward_amount int
  check (login_reward_amount is null or login_reward_amount >= 0);

-- 2. Streak state. current_streak is the number of consecutive local days opened, reset to 0
-- by a claim (and to 1 by an open after a missed day). last_open_day is the user's own local
-- day as the client reported it, never a UTC derivation: a 1am open after a night out is still
-- that night, and only the browser knows that. Zero-policy table: the client reads it through
-- get_login_reward_status()/get_group_login_streaks() only.
create table login_streaks (
  user_id uuid primary key references users (id) on delete cascade,
  current_streak int not null default 0 check (current_streak >= 0),
  last_open_day date,
  updated_at timestamptz not null default now()
);

alter table login_streaks enable row level security;

-- 3. A reward row is positive and, like a seed row, tied to no market or bet.
alter table ledger drop constraint ledger_seed_has_no_market_or_bet;
alter table ledger add constraint ledger_seed_has_no_market_or_bet check (
  (reason in ('seed', 'reward') and market_id is null and bet_id is null)
  or (reason = 'payout')
  or (reason in ('bet', 'refund') and market_id is not null and bet_id is not null)
);

alter table ledger drop constraint ledger_sign_matches_reason;
alter table ledger add constraint ledger_sign_matches_reason check (
  (reason = 'bet' and amount < 0)
  or (reason in ('seed', 'payout', 'refund', 'reward') and amount > 0)
);

-- 4. The first notification event about the app rather than about a group. group_id used to be
-- NOT NULL outright; it's now enforced by a CHECK that exempts exactly this one type, so every
-- existing event keeps its group and nothing else can quietly start emitting group-less rows.
-- Deliberately NOT also requiring actor_id on the exempt type, even though _record_app_open
-- always sets it: actor_id is `on delete set null` (20260822160000), so a CHECK demanding it
-- would make deleting an account fail on any still-unpurged day-7 event -- the exact
-- FK-blocks-deleteAccount bug class ARCHITECTURE.md's audit note is about. A nulled actor just
-- means get_event_recipients finds nobody, same as every other event type.
alter table notification_events alter column group_id drop not null;
alter table notification_events add constraint notification_events_group_events_have_group check (
  (event_type = 'login_reward_ready' and group_id is null)
  or (event_type <> 'login_reward_ready' and group_id is not null)
);

alter table notification_events drop constraint notification_events_market_events_have_market;
alter table notification_events add constraint notification_events_market_events_have_market check (
  (event_type in (
    'season_ended', 'betting_opened', 'member_joined',
    'group_deletion_scheduled', 'group_deletion_canceled', 'group_titles_updated',
    'season_betting_opened', 'group_deletion_scheduled_inactivity', 'admin_broadcast',
    'weekend_nudge', 'group_deletion_notice_14d', 'group_deletion_notice_7d', 'group_deletion_notice_1d',
    'assigned_group_moderator', 'system_markets_opened', 'login_reward_ready'
  ))
  or (market_id is not null)
);

-- 5a. The one place the amount formula lives, shared by claim_login_reward() and
-- get_login_reward_status() so the card can never promise a figure the claim doesn't pay.
-- Integer arithmetic floors: 100 -> 5, 1,000 -> 50, 15 -> 0 (so a tiny allocation with the
-- default left in place credits nothing, same as an explicit 0).
create or replace function _login_reward_amount(p_seed_amount int, p_login_reward_amount int)
returns int
language sql
immutable
set search_path = public
as $$
  select coalesce(p_login_reward_amount, (p_seed_amount * 5) / 100);
$$;

revoke execute on function _login_reward_amount(int, int) from public;
revoke execute on function _login_reward_amount(int, int) from anon;
-- No grant to authenticated: only ever called from inside the SECURITY DEFINER functions below,
-- which run as the owner, so exposing the helper through PostgREST would only add surface.
grant execute on function _login_reward_amount(int, int) to service_role;

-- 5b. The streak state machine, keyed by an explicit user id and an explicit local day, with
-- no clamp on the day -- service_role only. This is what the integration suite calls to drive a
-- backdated week of opens without waiting a week; the authenticated entry point below wraps it
-- in the +/-1 day check that stops a real client from doing the same thing.
--
-- Rules: the first open ever, or an open on the day right after last_open_day, advances the
-- counter; an open on last_open_day itself (or earlier -- a clock going backwards, or a second
-- device on a different local day) is a no-op; anything later than last_open_day + 1 is a
-- missed day and restarts the run at 1. The row is locked for update so two concurrent opens
-- (two tabs at midnight) can't both advance it.
create or replace function _record_app_open(p_user_id uuid, p_local_day date)
returns table (current_streak int, changed boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row login_streaks%rowtype;
  v_streak int;
begin
  if p_user_id is null then
    raise exception 'not_found: user not found';
  end if;
  if p_local_day is null then
    raise exception 'invalid_operation: a local day is required';
  end if;

  perform 1 from users where id = p_user_id;
  if not found then
    raise exception 'not_found: user not found';
  end if;

  insert into login_streaks (user_id) values (p_user_id) on conflict (user_id) do nothing;
  select * into v_row from login_streaks ls where ls.user_id = p_user_id for update;

  if v_row.last_open_day is not null and p_local_day <= v_row.last_open_day then
    return query select v_row.current_streak, false;
    return;
  end if;

  if v_row.last_open_day is not null and p_local_day = v_row.last_open_day + 1 then
    v_streak := v_row.current_streak + 1;
  else
    v_streak := 1;
  end if;

  update login_streaks ls
  set current_streak = v_streak, last_open_day = p_local_day, updated_at = now()
  where ls.user_id = p_user_id;

  -- Exactly the 6 -> 7 transition. Day 8, 9, ... of an unclaimed run stay quiet: one push per
  -- run, and the claim card on /profile is the reminder from there.
  if v_streak = 7 then
    perform _emit_notification_event('login_reward_ready', null, null, null, p_user_id);
  end if;

  return query select v_streak, true;
end;
$$;

revoke execute on function _record_app_open(uuid, date) from public;
revoke execute on function _record_app_open(uuid, date) from anon;
revoke execute on function _record_app_open(uuid, date) from authenticated;
grant execute on function _record_app_open(uuid, date) to service_role;

-- 5c. What the signed-in app shell calls on app open (RecordAppOpen, deduped per local day in
-- localStorage on the client so it's one call a day, not one per navigation). The local day is
-- the client's, because a server can't know it; the clamp is what keeps that honest. A real
-- local day is never more than one calendar day away from Postgres's UTC current_date (UTC-12
-- through UTC+14), so anything outside +/-1 is a client fast-forwarding (or backdating a fake
-- week) and gets refused rather than silently corrected.
create or replace function record_app_open(p_local_day date)
returns table (current_streak int, changed boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
begin
  if v_caller is null then
    raise exception 'not_found: user not found';
  end if;
  if p_local_day is null or p_local_day > current_date + 1 or p_local_day < current_date - 1 then
    raise exception 'invalid_operation: that day is out of range';
  end if;

  return query select * from _record_app_open(v_caller, p_local_day);
end;
$$;

revoke execute on function record_app_open(date) from public;
revoke execute on function record_app_open(date) from anon;
grant execute on function record_app_open(date) to authenticated;

-- 5d. The claim. One ledger row + balance bump per active membership whose effective amount is
-- more than 0, all in this transaction, then the streak drops to 0 (last_open_day stays put, so
-- tomorrow's open starts a new run at 1 and today's re-opens are no-ops). The streak row is
-- locked for update first, so a double-tap or two tabs can't both see 7 and both pay out.
-- Memberships that aren't 'active' (dormant, left, removed) are skipped: dormant members are
-- sitting the season out and get reseeded on opt-in anyway.
create or replace function claim_login_reward()
returns table (group_id uuid, group_name text, amount int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_row login_streaks%rowtype;
  rec record;
begin
  if v_caller is null then
    raise exception 'not_found: user not found';
  end if;

  select * into v_row from login_streaks ls where ls.user_id = v_caller for update;
  if v_row.user_id is null or v_row.current_streak < 7 then
    raise exception 'invalid_operation: no reward to claim yet, open the app seven days in a row first';
  end if;

  for rec in
    select mem.id as membership_id, g.id as gid, g.name as gname,
           _login_reward_amount(gs.seed_amount, gs.login_reward_amount) as amt
    from memberships mem
    join groups g on g.id = mem.group_id
    join group_settings gs on gs.group_id = g.id
    where mem.user_id = v_caller and mem.status = 'active'
    order by g.name, g.id
  loop
    if rec.amt > 0 then
      update memberships set balance = balance + rec.amt where id = rec.membership_id;
      insert into ledger (membership_id, amount, reason) values (rec.membership_id, rec.amt, 'reward');
      group_id := rec.gid;
      group_name := rec.gname;
      amount := rec.amt;
      return next;
    end if;
  end loop;

  update login_streaks ls set current_streak = 0, updated_at = now() where ls.user_id = v_caller;
  return;
end;
$$;

revoke execute on function claim_login_reward() from public;
revoke execute on function claim_login_reward() from anon;
grant execute on function claim_login_reward() to authenticated;

-- 5e. What /profile's streak/claim card reads: the caller's own streak plus, per active group,
-- the amount a claim would credit right now (0 for a group with the reward off).
create or replace function get_login_reward_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
begin
  if v_caller is null then
    raise exception 'not_found: user not found';
  end if;

  return jsonb_build_object(
    'current_streak', coalesce((select ls.current_streak from login_streaks ls where ls.user_id = v_caller), 0),
    'last_open_day', (select ls.last_open_day from login_streaks ls where ls.user_id = v_caller),
    'groups', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'group_id', g.id,
          'group_name', g.name,
          'amount', _login_reward_amount(gs.seed_amount, gs.login_reward_amount)
        )
        order by g.name, g.id
      )
      from memberships mem
      join groups g on g.id = mem.group_id
      join group_settings gs on gs.group_id = g.id
      where mem.user_id = v_caller and mem.status = 'active'
    ), '[]'::jsonb)
  );
end;
$$;

revoke execute on function get_login_reward_status() from public;
revoke execute on function get_login_reward_status() from anon;
grant execute on function get_login_reward_status() to authenticated;

-- 5f. Everyone's streak on one group's roster, for the member list. Deliberately visible to
-- fellow members: a count of days someone opened the app is about as low-stakes as a number
-- gets (no money, no bets, nothing is_market_visible() protects), and seeing a friend on day 5
-- is the whole social point of a streak. A non-member gets not_found, same as every other
-- group read.
create or replace function get_group_login_streaks(p_group_id uuid)
returns table (user_id uuid, current_streak int)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
begin
  perform 1 from memberships mem where mem.group_id = p_group_id and mem.user_id = v_caller and mem.status <> 'removed';
  if not found then
    raise exception 'not_found: group not found';
  end if;

  return query
  select mem.user_id, coalesce(ls.current_streak, 0)
  from memberships mem
  left join login_streaks ls on ls.user_id = mem.user_id
  where mem.group_id = p_group_id and mem.status in ('active', 'dormant');
end;
$$;

revoke execute on function get_group_login_streaks(uuid) from public;
revoke execute on function get_group_login_streaks(uuid) from anon;
grant execute on function get_group_login_streaks(uuid) to authenticated;

-- 6a. _notification_category: identical to 20260828130000's version plus login_reward_ready ->
-- nudges. It's the textbook nudge ("nothing happened, and that's the point": no market, no
-- group, just the app asking you back), and users.notify_nudges is the switch someone who wants
-- no prompting has already reached for. There's no group to mute it through, so the recipient
-- branch below passes true for the per-group half of _prefs_allow's nudges rule.
create or replace function _notification_category(p_event_type notification_event_type)
returns text
language sql
immutable
set search_path = public
as $$
  select case p_event_type::text
    when 'market_needs_endorsement' then 'markets'
    when 'market_opened' then 'markets'
    when 'market_opened_about_you' then 'markets'
    when 'market_closed' then 'markets'
    when 'system_markets_opened' then 'markets'

    when 'resolution_proposed' then 'results'
    when 'resolution_challenged' then 'results'
    when 'market_resolved' then 'results'
    when 'market_voided' then 'results'
    when 'clarification_requested' then 'results'
    when 'criteria_updated' then 'results'
    when 'impressive_bet' then 'results'
    when 'group_titles_updated' then 'results'

    when 'member_joined' then 'admin'
    when 'betting_opened' then 'admin'
    when 'season_betting_opened' then 'admin'
    when 'season_ended' then 'admin'
    when 'group_deletion_scheduled' then 'admin'
    when 'group_deletion_canceled' then 'admin'
    when 'group_deletion_scheduled_inactivity' then 'admin'
    when 'group_deletion_notice_14d' then 'admin'
    when 'group_deletion_notice_7d' then 'admin'
    when 'group_deletion_notice_1d' then 'admin'
    when 'assigned_group_moderator' then 'admin'

    when 'weekend_nudge' then 'nudges'
    when 'market_closing_soon' then 'nudges'
    when 'login_reward_ready' then 'nudges'

    -- The only channel that exists purely to market at someone.
    when 'admin_broadcast' then 'promos'

    else 'other'
  end;
$$;

-- 6b. get_event_recipients: identical to 20260828130000's version plus one branch,
-- login_reward_ready: single recipient = actor_id (impressive_bet's convention), no group and
-- so no memberships join -- just the user's own master switch, a live subscription, and the
-- global nudges preference.
create or replace function get_event_recipients(p_event_id uuid)
returns table (user_id uuid)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_event notification_events%rowtype;
  v_category text;
begin
  select * into v_event from notification_events where id = p_event_id;
  if v_event.id is null then
    return;
  end if;

  v_category := _notification_category(v_event.event_type);

  if v_event.event_type = 'member_joined' then
    return query
    select g.owner_id as user_id
    from groups g
    join memberships mem on mem.group_id = g.id and mem.user_id = g.owner_id and mem.status <> 'removed'
    join push_subscriptions ps on ps.user_id = g.owner_id
    join users u on u.id = g.owner_id and u.notifications_enabled = true
    where g.id = v_event.group_id
      and (v_event.actor_id is null or g.owner_id <> v_event.actor_id)
      and _prefs_allow(v_category, mem.notify_group, mem.notify_markets, mem.notify_results, mem.notify_admin, u.notify_nudges, u.notify_promos)
    group by g.owner_id;
  elsif v_event.event_type in ('impressive_bet', 'assigned_group_moderator') then
    return query
    select u.id as user_id
    from users u
    join memberships mem on mem.group_id = v_event.group_id and mem.user_id = u.id and mem.status <> 'removed'
    join push_subscriptions ps on ps.user_id = u.id
    where u.id = v_event.actor_id and u.notifications_enabled = true
      and _prefs_allow(v_category, mem.notify_group, mem.notify_markets, mem.notify_results, mem.notify_admin, u.notify_nudges, u.notify_promos)
    group by u.id;
  elsif v_event.event_type = 'login_reward_ready' then
    return query
    select u.id as user_id
    from users u
    join push_subscriptions ps on ps.user_id = u.id
    where u.id = v_event.actor_id and u.notifications_enabled = true
      and _prefs_allow(v_category, true, true, true, true, u.notify_nudges, u.notify_promos)
    group by u.id;
  elsif v_event.event_type = 'clarification_requested' then
    return query
    select m.creator_id as user_id
    from markets m
    join memberships mem on mem.group_id = m.group_id and mem.user_id = m.creator_id and mem.status <> 'removed'
    join push_subscriptions ps on ps.user_id = m.creator_id
    join users u on u.id = m.creator_id and u.notifications_enabled = true
    where m.id = v_event.market_id
      and (v_event.actor_id is null or m.creator_id <> v_event.actor_id)
      and _prefs_allow(v_category, mem.notify_group, mem.notify_markets, mem.notify_results, mem.notify_admin, u.notify_nudges, u.notify_promos)
    group by m.creator_id;
  elsif v_event.event_type = 'market_opened_about_you' then
    return query
    select ms.user_id
    from market_subjects ms
    join memberships mem on mem.group_id = v_event.group_id and mem.user_id = ms.user_id and mem.status = 'active'
    join push_subscriptions ps on ps.user_id = ms.user_id
    join users u on u.id = ms.user_id and u.notifications_enabled = true
    where ms.market_id = v_event.market_id
      and (v_event.actor_id is null or ms.user_id <> v_event.actor_id)
      and _prefs_allow(v_category, mem.notify_group, mem.notify_markets, mem.notify_results, mem.notify_admin, u.notify_nudges, u.notify_promos)
    group by ms.user_id;
  elsif v_event.event_type = 'weekend_nudge' then
    return query
    select mem.user_id
    from memberships mem
    join push_subscriptions ps on ps.user_id = mem.user_id
    join users u on u.id = mem.user_id and u.notifications_enabled = true
    where mem.group_id = v_event.group_id
      and mem.status = 'active'
      and _prefs_allow(v_category, mem.notify_group, mem.notify_markets, mem.notify_results, mem.notify_admin, u.notify_nudges, u.notify_promos)
    group by mem.user_id;
  elsif v_event.event_type = 'market_closing_soon' then
    return query
    select mem.user_id
    from memberships mem
    join push_subscriptions ps on ps.user_id = mem.user_id
    join users u on u.id = mem.user_id and u.notifications_enabled = true
    where mem.group_id = v_event.group_id
      and mem.status = 'active'
      and not exists (
        select 1 from market_subjects ms where ms.market_id = v_event.market_id and ms.user_id = mem.user_id
      )
      and not exists (
        select 1 from bets b where b.market_id = v_event.market_id and b.user_id = mem.user_id
      )
      and not exists (
        select 1
        from bets b
        join markets mk on mk.id = b.market_id
        where mk.group_id = v_event.group_id
          and b.user_id = mem.user_id
          and b.created_at > now() - interval '7 days'
      )
      and _prefs_allow(v_category, mem.notify_group, mem.notify_markets, mem.notify_results, mem.notify_admin, u.notify_nudges, u.notify_promos)
    group by mem.user_id;
  elsif v_event.event_type = 'admin_broadcast' then
    return query
    select mem.user_id
    from memberships mem
    join push_subscriptions ps on ps.user_id = mem.user_id
    join users u on u.id = mem.user_id and u.notifications_enabled = true
    where mem.group_id = v_event.group_id
      and mem.status <> 'removed'
      and (
        (v_event.target_user_id is not null and mem.user_id = v_event.target_user_id)
        or (v_event.target_user_id is null and (v_event.actor_id is null or mem.user_id <> v_event.actor_id))
      )
      and _prefs_allow(v_category, mem.notify_group, mem.notify_markets, mem.notify_results, mem.notify_admin, u.notify_nudges, u.notify_promos)
    group by mem.user_id;
  elsif v_event.event_type in (
    'season_ended', 'betting_opened', 'group_deletion_scheduled', 'group_deletion_canceled', 'group_titles_updated',
    'season_betting_opened', 'group_deletion_scheduled_inactivity',
    'group_deletion_notice_14d', 'group_deletion_notice_7d', 'group_deletion_notice_1d', 'system_markets_opened'
  ) then
    return query
    select mem.user_id
    from memberships mem
    join push_subscriptions ps on ps.user_id = mem.user_id
    join users u on u.id = mem.user_id and u.notifications_enabled = true
    where mem.group_id = v_event.group_id
      and mem.status <> 'removed'
      and (v_event.actor_id is null or mem.user_id <> v_event.actor_id)
      and _prefs_allow(v_category, mem.notify_group, mem.notify_markets, mem.notify_results, mem.notify_admin, u.notify_nudges, u.notify_promos)
    group by mem.user_id;
  else
    return query
    select gnr.user_id
    from get_notification_recipients(v_event.market_id, v_event.event_type in ('market_resolved', 'market_voided')) gnr
    join memberships mem on mem.group_id = v_event.group_id and mem.user_id = gnr.user_id
    join users u on u.id = gnr.user_id
    where (v_event.actor_id is null or gnr.user_id <> v_event.actor_id)
      and _prefs_allow(v_category, mem.notify_group, mem.notify_markets, mem.notify_results, mem.notify_admin, u.notify_nudges, u.notify_promos)
      -- A public group's roster doesn't all care about one specific market the way a small
      -- private group's does -- restrict every post-open event to people who actually bet on
      -- this market. market_opened is the invitation to bet in the first place, sent before
      -- anyone could have, so it stays unrestricted.
      and (
        v_event.event_type = 'market_opened'
        or not exists (select 1 from groups g where g.id = v_event.group_id and g.is_public)
        or exists (select 1 from bets b where b.market_id = v_event.market_id and b.user_id = gnr.user_id)
      );
  end if;
end;
$$;

revoke execute on function get_event_recipients(uuid) from public;
revoke execute on function get_event_recipients(uuid) from authenticated;
grant execute on function get_event_recipients(uuid) to service_role;
