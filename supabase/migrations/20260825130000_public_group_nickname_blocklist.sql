-- Nickname content filtering for public groups: a private group is small and self-policing (the
-- owner already sees everyone and can rename/remove anyone), but a public group's roster is
-- strangers browsing in from a directory, so a nickname is the one piece of content nobody
-- moderates before it's visible to the whole group. _nickname_contains_blocked_word() is a plain
-- substring check against a fixed list — nicknames are a single token with no spaces, so there's
-- no "word boundary" to match against the way a filter over sentences would use; a determined
-- bad actor could still work around this (leetspeak, split across a rename), but it stops the
-- overwhelming majority of casual attempts, which is the realistic bar for a v1. Kept as its own
-- function (not inlined into every caller) so the list lives in exactly one place to maintain.
create function _nickname_contains_blocked_word(p_nickname text)
returns boolean
language sql
immutable
as $$
  select exists (
    select 1 from unnest(array[
      -- Common profanity
      'fuck', 'shit', 'bitch', 'cunt', 'asshole', 'dick', 'pussy', 'bastard', 'twat', 'whore', 'slut',
      -- Slurs (racial, ethnic, homophobic, transphobic, ableist) — bases only, catches the common
      -- pluralized/suffixed forms via substring match.
      'nigger', 'nigga', 'chink', 'spic', 'kike', 'gook', 'wetback', 'beaner', 'coon', 'paki',
      'faggot', 'fag', 'dyke', 'tranny', 'retard', 'retarded',
      -- Slang for hard drugs / explicit sexual terms not already covered above
      'rape', 'nazi', 'hitler'
    ]) as word
    where position(word in lower(p_nickname)) > 0
  );
$$;

revoke execute on function _nickname_contains_blocked_word(text) from public;
grant execute on function _nickname_contains_blocked_word(text) to authenticated;

-- join_public_group: same 2-arg signature as 20260824150000_public_groups_directory.sql, plain
-- CREATE OR REPLACE — adds the blocklist check to both places a nickname is actually set (a
-- genuinely new join, and a 'left' member rejoining with a fresh nickname; a 'dormant' reactivation
-- keeps its existing nickname untouched, same as join_group, so there's nothing new to check there).
create or replace function join_public_group(p_group_id uuid, p_nickname citext default null)
returns setof memberships
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
  select * into v_group from groups where id = p_group_id and is_public = true;
  if v_group.id is null then
    raise exception 'not_found: group not found';
  end if;

  select * into v_membership from memberships where group_id = v_group.id and user_id = v_user_id;
  if v_membership.id is not null then
    if v_membership.status = 'removed' then
      raise exception 'forbidden: you can''t rejoin this group';
    end if;

    if v_membership.status = 'dormant' then
      update memberships set status = 'active' where id = v_membership.id returning * into v_membership;
      return next v_membership;
      return;
    end if;

    if v_membership.status = 'left' then
      if p_nickname is null or trim(p_nickname::text) = '' then
        raise exception 'invalid_operation: choose a nickname to join with';
      end if;
      if p_nickname::text !~ '^[A-Za-z0-9_]{1,20}$' then
        raise exception 'invalid_operation: nicknames can only use letters, numbers, and underscores, up to 20 characters';
      end if;
      if _nickname_contains_blocked_word(p_nickname::text) then
        raise exception 'invalid_operation: that nickname isn''t allowed, try a different one';
      end if;
      perform 1 from memberships where group_id = v_group.id and nickname = p_nickname and status not in ('removed', 'left');
      if found then
        raise exception 'invalid_operation: that nickname is already taken in this group';
      end if;

      update memberships set status = 'active', nickname = p_nickname where id = v_membership.id returning * into v_membership;
      return next v_membership;
      return;
    end if;

    return next v_membership;
    return;
  end if;

  -- Only a genuinely new membership reaches here.
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
  if _nickname_contains_blocked_word(p_nickname::text) then
    raise exception 'invalid_operation: that nickname isn''t allowed, try a different one';
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

    return next v_membership;
    return;
  end if;

  v_seed := case when v_settings.seasons_enabled then v_active_season.seed_amount else v_settings.seed_amount end;

  insert into memberships (group_id, user_id, balance, status, nickname)
  values (v_group.id, v_user_id, v_seed, 'active', p_nickname)
  returning * into v_membership;

  insert into ledger (membership_id, amount, reason)
  values (v_membership.id, v_seed, 'seed');

  perform _emit_notification_event('member_joined', v_group.id, null, null, v_user_id);

  return next v_membership;
  return;
end;
$$;

revoke execute on function join_public_group(uuid, citext) from public;
grant execute on function join_public_group(uuid, citext) to authenticated;

-- update_nickname: same 2-arg signature as 20260806130000_leave_group_clean_status.sql, plain
-- CREATE OR REPLACE — the blocklist only applies when the membership's group is public, so a
-- private group's members are unaffected (an owner who's fine with a crude inside joke keeps that
-- choice; a public group's owner isn't in a position to police every rename).
create or replace function update_nickname(p_group_id uuid, p_nickname citext)
returns memberships
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_membership memberships%rowtype;
  v_is_public boolean;
begin
  select * into v_membership from memberships where group_id = p_group_id and user_id = v_user_id and status not in ('removed', 'left') for update;
  if v_membership.id is null then
    raise exception 'not_found: not a member of this group';
  end if;

  p_nickname := lower(trim(coalesce(p_nickname::text, '')))::citext;
  if p_nickname::text = '' then
    raise exception 'invalid_operation: choose a nickname';
  end if;
  if p_nickname::text !~ '^[a-z0-9_]{1,20}$' then
    raise exception 'invalid_operation: nicknames can only use lowercase letters, numbers, and underscores, up to 20 characters';
  end if;

  select is_public into v_is_public from groups where id = p_group_id;
  if v_is_public and _nickname_contains_blocked_word(p_nickname::text) then
    raise exception 'invalid_operation: that nickname isn''t allowed, try a different one';
  end if;

  perform 1 from memberships where group_id = p_group_id and nickname = p_nickname and status not in ('removed', 'left') and user_id <> v_user_id;
  if found then
    raise exception 'invalid_operation: that nickname is already taken in this group';
  end if;

  update memberships set nickname = p_nickname where id = v_membership.id returning * into v_membership;
  return v_membership;
end;
$$;

revoke execute on function update_nickname(uuid, citext) from public;
grant execute on function update_nickname(uuid, citext) to authenticated;
