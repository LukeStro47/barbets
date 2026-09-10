-- Comments on markets (GitHub #90): a plain-text, member-only thread under every market, plus
-- an unread counter for the market card and one "this one's heating up" push per burst.
--
-- Pieces, in order:
--   1. market_comments -- the thread. Soft-deleted (deleted_at/deleted_by) rather than removed,
--      so a moderator's takedown leaves an audit row behind; the SELECT policy hides deleted
--      rows outright, so no client ever reads a deleted body back.
--   2. market_comment_reads -- one row per (market, member): when they last opened the thread.
--      Own-row SELECT only. Drives both the card's unread badge and the heating-up push's
--      "hasn't opened the thread" exclusion.
--   3. RLS: market_comments gets exactly one policy, SELECT gated by is_market_visible() --
--      the same choke point as bets/votes/reactions, so a subject sees the thread only once the
--      market resolves, identically to everything else about it. No INSERT/UPDATE/DELETE policy
--      on either table; every write goes through the SECURITY DEFINER functions below.
--   4. add_market_comment(), delete_market_comment(), mark_market_comments_read(),
--      report_market_comment(), get_unread_comment_counts().
--   5. _notification_category / get_event_recipients: carried forward from 20260909210000 in
--      full (including the login_reward_ready mapping and branch), plus the
--      market_comments_heating_up mapping and recipient branch.
--
-- Comments are deliberately OFF in public groups (add_market_comment raises invalid_operation
-- on groups.is_public): a public group is a pipeline group with moderator-only market creation
-- and no roster relationship between the strangers in it, and every report from one would land
-- on the platform admin. One `if` to flip later.

-- 1. The thread.
create table market_comments (
  id uuid primary key default gen_random_uuid(),
  market_id uuid not null references markets (id) on delete cascade,
  -- on delete set null, like bets.user_id: a deleted account must never be blocked by an old
  -- comment (the FK-blocks-deleteAccount bug class ARCHITECTURE.md's audit note is about).
  user_id uuid references users (id) on delete set null,
  body text not null,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by uuid references users (id) on delete set null
);

-- The thread read (market, newest at the bottom), the burst count (market, last 60s) and the
-- unread count (market, newer than last_read_at) all walk this one index.
create index market_comments_market_created_idx on market_comments (market_id, created_at);

-- add_market_comment's once-per-hour lid asks "has a market_comments_heating_up event fired for this
-- market in the last hour"; notification_events only had a partial index on created_at for the
-- unprocessed queue, so without this the check would walk every event the market ever emitted.
create index if not exists notification_events_market_type_created_idx
  on notification_events (market_id, event_type, created_at);

alter table market_comments enable row level security;

create policy market_comments_select on market_comments for select
  to authenticated
  using (deleted_at is null and is_market_visible(market_id, (select auth.uid())));

-- 2. Last-opened marker.
create table market_comment_reads (
  market_id uuid not null references markets (id) on delete cascade,
  user_id uuid not null references users (id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (market_id, user_id)
);

alter table market_comment_reads enable row level security;

create policy market_comment_reads_select_own on market_comment_reads for select
  to authenticated
  using (user_id = (select auth.uid()));

-- 4a. Post a comment. Member-only through is_market_visible() (a subject of an unresolved
-- market, a non-member, and a nonexistent market all get the same not_found), then the
-- public-group switch, then the voided check, then the body rules: trimmed, non-empty, at most
-- 500 characters (lib/limits.ts's MARKET_COMMENT_MAX_LENGTH), newlines kept.
--
-- The push rule lives here so it's transactional with the insert: once this comment makes it
-- 5+ live comments inside the last 60 seconds, and no market_comments_heating_up event exists
-- for this market in the last hour, emit exactly one. The market row is locked for update
-- first so two fifth-comments landing at once can't both pass the "no event yet" check.
create or replace function add_market_comment(p_market_id uuid, p_body text)
returns market_comments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_body text := btrim(replace(coalesce(p_body, ''), E'\r\n', E'\n'), E' \t\r\n');
  v_market markets%rowtype;
  v_is_public boolean;
  v_row market_comments%rowtype;
  v_recent int;
begin
  if not is_market_visible(p_market_id, v_user_id) then
    raise exception 'not_found: market not found';
  end if;

  select * into v_market from markets where id = p_market_id for update;
  if v_market.id is null then
    raise exception 'not_found: market not found';
  end if;

  select g.is_public into v_is_public from groups g where g.id = v_market.group_id;
  if coalesce(v_is_public, false) then
    raise exception 'invalid_operation: comments are off in public groups';
  end if;

  if v_market.status = 'voided' then
    raise exception 'invalid_operation: this market was voided, so the thread is closed';
  end if;

  if v_body = '' then
    raise exception 'invalid_operation: say something first';
  end if;
  if length(v_body) > 500 then
    raise exception 'invalid_operation: keep a comment under 500 characters';
  end if;

  insert into market_comments (market_id, user_id, body)
  values (p_market_id, v_user_id, v_body)
  returning * into v_row;

  select count(*) into v_recent
  from market_comments c
  where c.market_id = p_market_id
    and c.deleted_at is null
    and c.created_at > now() - interval '60 seconds';

  if v_recent >= 5 and not exists (
    select 1 from notification_events ne
    where ne.event_type = 'market_comments_heating_up'
      and ne.market_id = p_market_id
      and ne.created_at > now() - interval '1 hour'
  ) then
    perform _emit_notification_event('market_comments_heating_up', v_market.group_id, p_market_id, null, v_user_id);
  end if;

  return v_row;
end;
$$;

revoke execute on function add_market_comment(uuid, text) from public;
revoke execute on function add_market_comment(uuid, text) from anon;
grant execute on function add_market_comment(uuid, text) to authenticated;

-- 4b. Soft delete. The comment's own author, or the group's owner/moderator
-- (_is_group_mod_or_owner, the same gate every mod action uses). A comment the caller can't
-- see (subject, non-member, already deleted, nonexistent) is not_found, not forbidden; a
-- member who can see it but isn't allowed to remove it gets forbidden, since there's nothing
-- to hide from someone the thread is already open to.
create or replace function delete_market_comment(p_comment_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_comment market_comments%rowtype;
  v_group_id uuid;
begin
  select * into v_comment from market_comments c where c.id = p_comment_id;
  if v_comment.id is null or v_comment.deleted_at is not null or not is_market_visible(v_comment.market_id, v_user_id) then
    raise exception 'not_found: comment not found';
  end if;

  select m.group_id into v_group_id from markets m where m.id = v_comment.market_id;

  if v_comment.user_id is distinct from v_user_id and not _is_group_mod_or_owner(v_group_id, v_user_id) then
    raise exception 'forbidden: only the comment''s author or the group owner can delete it';
  end if;

  update market_comments
  set deleted_at = now(), deleted_by = v_user_id
  where id = p_comment_id;
end;
$$;

revoke execute on function delete_market_comment(uuid) from public;
revoke execute on function delete_market_comment(uuid) from anon;
grant execute on function delete_market_comment(uuid) to authenticated;

-- 4c. "I've opened the thread." Upsert; the client calls it on mount and after each post.
create or replace function mark_market_comments_read(p_market_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if not is_market_visible(p_market_id, v_user_id) then
    raise exception 'not_found: market not found';
  end if;

  insert into market_comment_reads (market_id, user_id, last_read_at)
  values (p_market_id, v_user_id, now())
  on conflict (market_id, user_id) do update set last_read_at = excluded.last_read_at;
end;
$$;

revoke execute on function mark_market_comments_read(uuid) from public;
revoke execute on function mark_market_comments_read(uuid) from anon;
grant execute on function mark_market_comments_read(uuid) to authenticated;

-- 4d. Report a comment. Reuses the feedback pipeline rather than a new table: the row lands in
-- the zero-policy `feedback` table exactly as submit_feedback() writes it (category 'general',
-- group_id = the market's group, page_url = the market page), and lib/actions/feedback.ts's
-- reportMarketComment() posts the same Slack card submitFeedback() does, so a report reaches
-- #feedback through the one path that already exists. The message carries everything a
-- reviewer needs without opening the app: comment id, author, market, group, the body
-- verbatim, and the reporter's reason if they gave one.
create or replace function report_market_comment(p_comment_id uuid, p_reason text default null)
returns feedback
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_comment market_comments%rowtype;
  v_reason text := btrim(coalesce(p_reason, ''), E' \t\r\n');
  v_group_id uuid;
  v_group_name text;
  v_title text;
  v_author text;
  v_message text;
  v_row feedback%rowtype;
begin
  select * into v_comment from market_comments c where c.id = p_comment_id;
  if v_comment.id is null or v_comment.deleted_at is not null or not is_market_visible(v_comment.market_id, v_user_id) then
    raise exception 'not_found: comment not found';
  end if;

  if length(v_reason) > 500 then
    raise exception 'invalid_operation: keep the reason under 500 characters';
  end if;

  select m.group_id, m.title, g.name into v_group_id, v_title, v_group_name
  from markets m
  join groups g on g.id = m.group_id
  where m.id = v_comment.market_id;

  select mem.nickname into v_author
  from memberships mem
  where mem.group_id = v_group_id and mem.user_id = v_comment.user_id;

  v_message := 'Reported comment ' || v_comment.id
    || E'\nBy: @' || coalesce(v_author, 'unknown')
    || E'\nMarket: "' || v_title || '" (' || v_comment.market_id || ')'
    || E'\nGroup: ' || v_group_name || ' (' || v_group_id || ')'
    || E'\n\n> ' || replace(v_comment.body, E'\n', E'\n> ')
    || case when v_reason <> '' then E'\n\nReason: ' || v_reason else '' end;

  insert into feedback (user_id, message, page_url, category, wants_followup, group_id)
  values (
    v_user_id,
    v_message,
    '/groups/' || v_group_id || '/markets/' || v_comment.market_id,
    'general',
    false,
    v_group_id
  )
  returning * into v_row;

  return v_row;
end;
$$;

revoke execute on function report_market_comment(uuid, text) from public;
revoke execute on function report_market_comment(uuid, text) from anon;
grant execute on function report_market_comment(uuid, text) to authenticated;

-- 4e. The card badge: for each of the given markets the caller can see, how many live comments
-- by other people are newer than their last_read_at (all of them, if they've never opened the
-- thread). One call per feed half (lib/groupFeed.ts), never one per card. Markets with nothing
-- unread are simply absent from the result.
create or replace function get_unread_comment_counts(p_market_ids uuid[])
returns table (market_id uuid, unread_count int)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    return;
  end if;

  return query
  with visible as (
    select t.id
    from unnest(p_market_ids) as t(id)
    where is_market_visible(t.id, v_user_id)
  )
  select c.market_id, count(*)::int
  from visible v
  join market_comments c on c.market_id = v.id
  left join market_comment_reads r on r.market_id = c.market_id and r.user_id = v_user_id
  where c.deleted_at is null
    and c.user_id is distinct from v_user_id
    and (r.last_read_at is null or c.created_at > r.last_read_at)
  group by c.market_id;
end;
$$;

revoke execute on function get_unread_comment_counts(uuid[]) from public;
revoke execute on function get_unread_comment_counts(uuid[]) from anon;
grant execute on function get_unread_comment_counts(uuid[]) to authenticated;

-- 5a. _notification_category: identical to 20260909210000's version plus
-- market_comments_heating_up -> markets ("something happened in a group you're in", the
-- per-group notify_markets switch). The login_reward_ready -> nudges mapping is carried forward.
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
    when 'market_comments_heating_up' then 'markets'

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

-- 5b. get_event_recipients: identical to 20260909210000's version (every branch carried
-- forward, login_reward_ready included) plus one branch, market_comments_heating_up:
-- market-scoped through get_notification_recipients() (active members with a live
-- subscription, subjects excluded), actor excluded, and additionally excluding anyone whose
-- market_comment_reads.last_read_at is at or after the burst's first comment -- they opened
-- the thread while it was heating up, so they already know. The burst is anchored on the
-- event's own created_at (the fifth comment's transaction), not on now(), so the answer is
-- the same whether send-push runs a second or a minute later.
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
  elsif v_event.event_type = 'market_comments_heating_up' then
    return query
    select gnr.user_id
    from get_notification_recipients(v_event.market_id, false) gnr
    join memberships mem on mem.group_id = v_event.group_id and mem.user_id = gnr.user_id
    join users u on u.id = gnr.user_id
    where (v_event.actor_id is null or gnr.user_id <> v_event.actor_id)
      and not exists (
        select 1
        from market_comment_reads r
        where r.market_id = v_event.market_id
          and r.user_id = gnr.user_id
          and r.last_read_at >= (
            select coalesce(min(c.created_at), v_event.created_at)
            from market_comments c
            where c.market_id = v_event.market_id
              and c.deleted_at is null
              and c.created_at > v_event.created_at - interval '60 seconds'
              and c.created_at <= v_event.created_at
          )
      )
      and _prefs_allow(v_category, mem.notify_group, mem.notify_markets, mem.notify_results, mem.notify_admin, u.notify_nudges, u.notify_promos);
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
