-- Invite codes are the one secret in this app a stranger can simply guess at.
-- They're 4 characters, and two functions will tell you whether any given
-- string is a real group: get_group_by_invite_code() hands back the group's
-- name, join_group() walks you straight in. Both are granted to
-- `authenticated`, so the real surface isn't the two Next.js screens in front
-- of them, it's the PostgREST endpoint with any signed-up account's JWT
-- hitting either function in a loop. That's why this limit lives in the
-- database: it's the only place both entry points (and any direct RPC call
-- that skips the app entirely) have to pass through.
--
-- The rule: 10 misses per user per hour, counted across both functions
-- together, so spending the budget on previews leaves none for joins.
--
-- Only a *miss* counts. Previewing or joining with a code that really exists
-- is what an invited person actually does, however many times they do it, and
-- a member reopening a live /join link should never be able to lock
-- themselves out of their own group.
--
-- The non-obvious part is why the two miss paths stopped raising. A RAISE
-- aborts the transaction, which would roll back the very increment that makes
-- this work — a wrong code can be counted or be raised, never both.
-- get_group_by_invite_code() already signalled "no such code" by returning
-- zero rows, so nothing changes there. join_group() now returns NULL instead
-- of raising 'not_found: invalid invite code', and lib/actions/groups.ts turns
-- that null into the same friendly copy the raise used to produce. The rate
-- limit itself still raises (invalid_operation) — there's nothing left to
-- write at that point, so there's nothing for the abort to undo.
create table invite_code_attempts (
  user_id uuid primary key references users (id) on delete cascade,
  miss_count int not null default 0,
  -- The window's *end*, not its start, so the interval that defines how long a
  -- window lasts is written in exactly one place (_record_invite_code_miss)
  -- and can't drift from the freshness check that reads it.
  window_ends_at timestamptz not null
);

-- A fourth zero-policy table, alongside notification_events / app_admins /
-- feedback: RLS on, no policy of any kind, so no `authenticated` role can read
-- or write it at all. Nothing in the app has a legitimate client-side read of
-- someone's attempt counter, and a client that could UPDATE it could reset its
-- own limit.
alter table invite_code_attempts enable row level security;

-- Called before either lookup. Reads only, so it's safe to call from a path
-- that goes on to raise.
create function _enforce_invite_code_rate_limit()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_row invite_code_attempts%rowtype;
  v_wait_minutes int;
begin
  if v_user_id is null then
    return;
  end if;

  select * into v_row from invite_code_attempts where user_id = v_user_id;
  if v_row.user_id is null or v_row.window_ends_at <= now() or v_row.miss_count < 10 then
    return;
  end if;

  v_wait_minutes := greatest(1, ceil(extract(epoch from (v_row.window_ends_at - now())) / 60))::int;
  raise exception 'invalid_operation: too many invite code tries, wait % minute% and try again',
    v_wait_minutes, case when v_wait_minutes = 1 then '' else 's' end;
end;
$$;

-- Called only when a code matched no group. Must never be followed by a RAISE
-- in the same transaction, or the increment is rolled back with it.
create function _record_invite_code_miss()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    return;
  end if;

  insert into invite_code_attempts (user_id, miss_count, window_ends_at)
  values (v_user_id, 1, now() + interval '1 hour')
  on conflict (user_id) do update set
    miss_count = case when invite_code_attempts.window_ends_at > now() then invite_code_attempts.miss_count + 1 else 1 end,
    window_ends_at = case when invite_code_attempts.window_ends_at > now() then invite_code_attempts.window_ends_at else now() + interval '1 hour' end;
end;
$$;

revoke execute on function _enforce_invite_code_rate_limit() from public;
revoke execute on function _enforce_invite_code_rate_limit() from authenticated;
revoke execute on function _record_invite_code_miss() from public;
revoke execute on function _record_invite_code_miss() from authenticated;

-- get_group_by_invite_code has to become VOLATILE plpgsql to do any of this:
-- PostgREST runs a STABLE function inside a read-only transaction, so the
-- counter write would fail outright, not just get skipped. Same signature and
-- same return shape as before; dropped and recreated rather than replaced
-- because the language and volatility both change.
drop function if exists get_group_by_invite_code(text);

create function get_group_by_invite_code(p_invite_code text)
returns table (id uuid, name text, accepting_members boolean, my_status text)
language plpgsql
security definer
set search_path = public
as $$
begin
  perform _enforce_invite_code_rate_limit();

  return query
    select
      g.id,
      g.name,
      gs.accepting_members,
      (select m.status::text from memberships m where m.group_id = g.id and m.user_id = auth.uid())
    from groups g
    join group_settings gs on gs.group_id = g.id
    where g.invite_code = p_invite_code::citext;

  -- FOUND is false when the RETURN QUERY above produced no rows: a guess.
  if not found then
    perform _record_invite_code_miss();
  end if;
end;
$$;

revoke execute on function get_group_by_invite_code(text) from public;
grant execute on function get_group_by_invite_code(text) to authenticated;

-- join_group: unchanged except for the rate-limit check at the top and the
-- invalid-code branch, which now records the miss and returns NULL instead of
-- raising 'not_found: invalid invite code' (see the note above). Every other
-- rejection still raises exactly as before — they all require a code that
-- really exists, so there's nothing to count on those paths and nothing for
-- their abort to undo.
create or replace function join_group(p_invite_code text, p_nickname citext default null)
returns memberships
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_group groups%rowtype;
  v_settings group_settings%rowtype;
  v_active_season seasons%rowtype;
  v_intermission_season seasons%rowtype;
  v_membership memberships%rowtype;
  v_seed int;
begin
  perform _enforce_invite_code_rate_limit();

  select * into v_group from groups where invite_code = p_invite_code::citext;
  if v_group.id is null then
    perform _record_invite_code_miss();
    return null;
  end if;

  select * into v_membership from memberships where group_id = v_group.id and user_id = v_user_id;
  if v_membership.id is not null then
    if v_membership.status = 'removed' then
      raise exception 'forbidden: you can''t rejoin this group';
    end if;

    if v_membership.status = 'dormant' then
      update memberships set status = 'active' where id = v_membership.id returning * into v_membership;
      return v_membership;
    end if;

    if v_membership.status = 'left' then
      if p_nickname is null or trim(p_nickname::text) = '' then
        raise exception 'invalid_operation: choose a nickname to join with';
      end if;
      if p_nickname::text !~ '^[A-Za-z0-9_]{1,20}$' then
        raise exception 'invalid_operation: nicknames can only use letters, numbers, and underscores, up to 20 characters';
      end if;
      perform 1 from memberships where group_id = v_group.id and nickname = p_nickname and status not in ('removed', 'left');
      if found then
        raise exception 'invalid_operation: that nickname is already taken in this group';
      end if;

      update memberships set status = 'active', nickname = p_nickname where id = v_membership.id returning * into v_membership;
      return v_membership;
    end if;

    return v_membership;
  end if;

  -- Only a genuinely new membership reaches here.
  if v_group.deletion_scheduled_at is not null then
    raise exception 'invalid_operation: this group is scheduled for deletion and isn''t taking new members';
  end if;

  select * into v_settings from group_settings where group_id = v_group.id;
  if not v_settings.accepting_members then
    raise exception 'invalid_operation: this group isn''t accepting new members right now';
  end if;

  if p_nickname is null or trim(p_nickname::text) = '' then
    raise exception 'invalid_operation: choose a nickname to join with';
  end if;
  if p_nickname::text !~ '^[A-Za-z0-9_]{1,20}$' then
    raise exception 'invalid_operation: nicknames can only use letters, numbers, and underscores, up to 20 characters';
  end if;
  perform 1 from memberships where group_id = v_group.id and nickname = p_nickname and status not in ('removed', 'left');
  if found then
    raise exception 'invalid_operation: that nickname is already taken in this group';
  end if;

  if v_settings.seasons_enabled then
    select * into v_active_season from seasons where group_id = v_group.id and status = 'active';
  end if;

  if v_settings.seasons_enabled and v_active_season.id is null then
    select * into v_intermission_season from seasons where group_id = v_group.id and status = 'intermission';

    insert into memberships (group_id, user_id, balance, status, nickname)
    values (v_group.id, v_user_id, 0, 'dormant', p_nickname)
    returning * into v_membership;

    if v_intermission_season.id is not null then
      insert into season_optins (season_id, user_id)
      values (v_intermission_season.id, v_user_id)
      on conflict do nothing;
    end if;

    perform _emit_notification_event('member_joined', v_group.id, null, null, v_user_id);

    return v_membership;
  end if;

  v_seed := case when v_settings.seasons_enabled then v_active_season.seed_amount else v_settings.seed_amount end;

  insert into memberships (group_id, user_id, balance, status, nickname)
  values (v_group.id, v_user_id, v_seed, 'active', p_nickname)
  returning * into v_membership;

  insert into ledger (membership_id, amount, reason)
  values (v_membership.id, v_seed, 'seed');

  perform _emit_notification_event('member_joined', v_group.id, null, null, v_user_id);

  return v_membership;
end;
$$;

revoke execute on function join_group(text, citext) from public;
grant execute on function join_group(text, citext) to authenticated;
