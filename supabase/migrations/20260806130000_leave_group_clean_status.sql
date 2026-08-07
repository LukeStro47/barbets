-- leave_group now sets status = 'left' instead of 'dormant'. Unlike dormant
-- (still fully visible everywhere, nickname still reserved), 'left' means:
-- nickname frees up immediately, the group disappears from every "who's
-- currently here" surface via RLS, but historical bet/ledger activity stays
-- intact for the leaderboard to surface if the leaver ever actually bet
-- (handled in the leaderboard page's own query, not here) — and they can
-- still rejoin at any time, same as dormant always could.
--
-- _cleanup_departing_member's behavior (void subject markets, don't refund
-- the leaver's own open bets) is unchanged.
create or replace function leave_group(p_group_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_group groups%rowtype;
begin
  select * into v_group from groups where id = p_group_id;
  if v_group.id is null then
    raise exception 'not_found: group not found';
  end if;

  perform 1 from memberships where group_id = p_group_id and user_id = v_user_id and status not in ('removed', 'left') for update;
  if not found then
    raise exception 'not_found: group not found';
  end if;

  if v_user_id = v_group.owner_id then
    raise exception 'invalid_operation: the owner cannot leave their own group';
  end if;

  perform _cleanup_departing_member(p_group_id, v_user_id, false);

  update memberships set status = 'left'
  where group_id = p_group_id and user_id = v_user_id;
end;
$$;

revoke execute on function leave_group(uuid) from public;
grant execute on function leave_group(uuid) to authenticated;

-- The two RLS choke points: excluding 'left' here (same as 'removed' always
-- was) is what makes a group and everything in it disappear from a left
-- member's own queries — every policy that calls these gets this for free,
-- no per-policy changes needed. Does not affect what OTHER still-active
-- members can see about a left member's historical rows (those policies key
-- off the VIEWER's own status, not the row owner's), which is exactly what
-- lets the leaderboard keep surfacing a left member's real betting history.
create or replace function _caller_is_active_group_member(p_group_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from memberships
    where group_id = p_group_id and user_id = auth.uid() and status not in ('removed', 'left')
  );
$$;

create or replace function is_market_visible(p_market_id uuid, p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from markets m
    join memberships mem
      on mem.group_id = m.group_id and mem.user_id = p_user_id and mem.status not in ('removed', 'left')
    where m.id = p_market_id
      and (
        not exists (
          select 1 from market_subjects ms
          where ms.market_id = m.id and ms.user_id = p_user_id
        )
        or m.status in ('resolved', 'voided')
      )
  );
$$;

-- Nickname frees up the moment someone leaves (unlike dormant, which keeps
-- it reserved) — same treatment 'removed' already got.
drop index if exists memberships_group_nickname_unique;
create unique index memberships_group_nickname_unique on memberships (group_id, nickname) where status not in ('removed', 'left');

-- update_nickname: same exclusion in both the caller-eligibility check and
-- the collision check — a left member has no standing to rename themselves
-- in a group they're not currently part of, and shouldn't be able to
-- collide with (or be blocked by) another left member's old name.
create or replace function update_nickname(p_group_id uuid, p_nickname citext)
returns memberships
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_membership memberships%rowtype;
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

  perform 1 from memberships where group_id = p_group_id and nickname = p_nickname and status not in ('removed', 'left') and user_id <> v_user_id;
  if found then
    raise exception 'invalid_operation: that nickname is already taken in this group';
  end if;

  update memberships set nickname = p_nickname where id = v_membership.id returning * into v_membership;
  return v_membership;
end;
$$;

-- join_group gains a third rejoin branch. 'dormant' keeps reactivating in
-- place with the same reserved nickname, unchanged. 'left' also reactivates
-- in place (never reseeded, same as dormant) but its nickname was released
-- when they left, so it may belong to someone else now — re-validate/apply
-- whatever nickname the join form sent, same rules a brand-new join uses.
-- (The join UI already always collects and sends a nickname on every join
-- attempt, including a returning invite-code use, so no client change is
-- needed for this branch to have something to validate.)
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
  select * into v_group from groups where invite_code = p_invite_code::citext;
  if v_group.id is null then
    raise exception 'not_found: invalid invite code';
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

-- create_market's member_count feeds the subject-cap privacy invariant
-- (member_count - 2). A lingering 'left' member inflating that count would
-- make the cap more permissive than intended, since they can't actually
-- fill a creator/endorser/bettor role for this market anymore — exclude
-- them the same as 'removed'. Also tighten create_market's own entry gate
-- to match, since we're already redeclaring this function.
create or replace function create_market(
  p_group_id uuid,
  p_title text,
  p_description text,
  p_market_type market_type,
  p_closes_at timestamptz,
  p_line numeric default null,
  p_subject_user_ids uuid[] default '{}',
  p_options text[] default null
) returns markets
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_settings group_settings%rowtype;
  v_season_id uuid;
  v_member_count int;
  v_subject_ids uuid[];
  v_invalid_subject_count int;
  v_market markets%rowtype;
  v_option_count int;
  v_option_id uuid;
  v_option_text text;
  v_resolved_user_id uuid;
  v_all_subject_ids uuid[];
  v_idx int;
begin
  perform 1 from memberships where group_id = p_group_id and user_id = v_user_id and status not in ('removed', 'left');
  if not found then
    raise exception 'not_found: not a member of this group';
  end if;

  perform 1 from groups where id = p_group_id and deletion_scheduled_at is not null;
  if found then
    raise exception 'invalid_operation: this group is scheduled for deletion and can''t start new markets';
  end if;

  select * into v_settings from group_settings where group_id = p_group_id;
  if not v_settings.betting_enabled then
    raise exception 'invalid_operation: the group owner hasn''t turned betting on yet';
  end if;

  if p_closes_at <= now() then
    raise exception 'invalid_operation: closes_at must be in the future';
  end if;

  if v_settings.seasons_enabled then
    select id into v_season_id from seasons where group_id = p_group_id and status = 'active';
    if v_season_id is null then
      raise exception 'invalid_operation: the group is between seasons, wait for the new season to start';
    end if;
  end if;

  select count(*) into v_member_count from memberships where group_id = p_group_id and status not in ('removed', 'left');

  if p_market_type = 'multiple_choice' then
    v_option_count := coalesce(array_length(p_options, 1), 0);
    if v_option_count < 2 or v_option_count > 10 then
      raise exception 'invalid_operation: multiple choice markets need between 2 and 10 options';
    end if;

    if exists (select 1 from unnest(p_options) as o where trim(o) = '') then
      raise exception 'invalid_operation: option labels cannot be blank';
    end if;

    if (select count(distinct trim(o)) from unnest(p_options) as o) <> v_option_count then
      raise exception 'invalid_operation: option labels must be unique';
    end if;

    v_all_subject_ids := '{}';
    for v_idx in 1 .. v_option_count loop
      v_option_text := trim(p_options[v_idx]);
      if left(v_option_text, 1) = '@' then
        select m.user_id into v_resolved_user_id
        from memberships m
        where m.group_id = p_group_id and m.nickname = substring(v_option_text from 2) and m.status = 'active';
        if v_resolved_user_id is null then
          raise exception 'invalid_operation: no active member named % in this group', v_option_text;
        end if;
        v_all_subject_ids := v_all_subject_ids || v_resolved_user_id;
      end if;
    end loop;

    if array_length(v_all_subject_ids, 1) > 0 then
      if array_length(v_all_subject_ids, 1) <> (select count(distinct x) from unnest(v_all_subject_ids) as x) then
        raise exception 'invalid_operation: a member can only be a subject of one option';
      end if;

      if v_user_id = any(v_all_subject_ids) then
        raise exception 'invalid_operation: the creator cannot be a subject of their own market';
      end if;

      if array_length(v_all_subject_ids, 1) >= v_member_count - 1 then
        raise exception 'invalid_operation: this group has % members, so a market can have at most % subject(s). enough people need to be left to create, endorse, and bet on it', v_member_count, greatest(v_member_count - 2, 0);
      end if;
    end if;

    insert into markets (group_id, season_id, title, description, market_type, line, creator_id, closes_at)
    values (p_group_id, v_season_id, p_title, p_description, p_market_type, null, v_user_id, p_closes_at)
    returning * into v_market;

    for v_idx in 1 .. v_option_count loop
      v_option_text := trim(p_options[v_idx]);

      insert into market_options (market_id, label, sort_order)
      values (v_market.id, v_option_text, v_idx)
      returning id into v_option_id;

      if left(v_option_text, 1) = '@' then
        select m.user_id into v_resolved_user_id
        from memberships m
        where m.group_id = p_group_id and m.nickname = substring(v_option_text from 2) and m.status = 'active';

        insert into market_subjects (market_id, user_id, option_id)
        values (v_market.id, v_resolved_user_id, v_option_id);
      end if;
    end loop;
  else
    select array_agg(distinct x) into v_subject_ids from unnest(p_subject_user_ids) as x;

    if v_subject_ids is not null and v_user_id = any(v_subject_ids) then
      raise exception 'invalid_operation: the creator cannot be a subject of their own market';
    end if;

    if v_subject_ids is not null then
      if array_length(v_subject_ids, 1) >= v_member_count - 1 then
        raise exception 'invalid_operation: this group has % members, so a market can have at most % subject(s). enough people need to be left to create, endorse, and bet on it', v_member_count, greatest(v_member_count - 2, 0);
      end if;

      select count(*) into v_invalid_subject_count
      from unnest(v_subject_ids) as x
      where not exists (
        select 1 from memberships where group_id = p_group_id and user_id = x and status = 'active'
      );
      if v_invalid_subject_count > 0 then
        raise exception 'invalid_operation: all subjects must be active members of the group';
      end if;
    end if;

    insert into markets (group_id, season_id, title, description, market_type, line, creator_id, closes_at)
    values (p_group_id, v_season_id, p_title, p_description, p_market_type, p_line, v_user_id, p_closes_at)
    returning * into v_market;

    if v_subject_ids is not null then
      insert into market_subjects (market_id, user_id)
      select v_market.id, x from unnest(v_subject_ids) as x;
    end if;
  end if;

  perform _emit_notification_event('market_needs_endorsement', p_group_id, v_market.id, null, v_user_id);

  return v_market;
end;
$$;

revoke execute on function create_market(uuid, text, text, market_type, timestamptz, numeric, uuid[], text[]) from public;
grant execute on function create_market(uuid, text, text, market_type, timestamptz, numeric, uuid[], text[]) to authenticated;
