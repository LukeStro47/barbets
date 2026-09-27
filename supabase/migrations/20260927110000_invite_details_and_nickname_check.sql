-- Two lookups for the signed-in join flow (5d/5e of the Ledger redesign).
--
-- get_invite_details: 5e's "You've been invited" card. On top of what
-- get_group_by_invite_code() already returns (name, avatar, whether it's
-- taking members), the mock shows a member count, a row of faces, and three
-- figures: open markets, settled markets, and how long the group has been
-- running. It also shows the group's real open market questions, which this
-- deliberately does NOT return: a market's title is member-only content, and
-- is_market_visible() is the one place that decides who sees it. A code is a
-- 4-character secret anyone can be handed or guess, so everything here is a
-- count or a face, never a market's content. Confirmed with the product owner
-- as "counts and faces only". "Marcus invited you" is also left out: invite
-- codes aren't per-person, so nothing records who handed this code over.
--
-- The open count skips markets the caller is the hidden subject of (possible
-- for someone who left and is coming back), so even the number can't tell
-- them a market about them exists.
--
-- opening_balance mirrors join_group()'s own seed rule: the active season's
-- seed_amount, the group's seed_amount without seasons, and NULL during an
-- intermission (join_group() lands the joiner as a dormant member with 0 then,
-- so there is no opening balance to promise).
--
-- resolution_window_hours is for 5g's "the group has N hours to object" line,
-- a group rule every member sees on the rules page anyway.
--
-- Faces are up to four members' avatar fields plus the first letter of the
-- nickname (all the avatar fallback needs), never the nickname itself.
--
-- Same rate-limit posture as get_group_by_invite_code(): only a miss counts,
-- and a miss returns zero rows rather than raising, so the counter write
-- survives.
create function get_invite_details(p_invite_code text)
returns table (
  member_count int,
  open_count int,
  settled_count int,
  created_at timestamptz,
  opening_balance int,
  resolution_window_hours numeric,
  faces jsonb
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_group groups%rowtype;
  v_settings group_settings%rowtype;
  v_season seasons%rowtype;
  v_opening int;
begin
  perform _enforce_invite_code_rate_limit();

  select * into v_group from groups where invite_code = p_invite_code::citext;
  if v_group.id is null then
    perform _record_invite_code_miss();
    return;
  end if;

  select * into v_settings from group_settings where group_id = v_group.id;
  if v_settings.seasons_enabled then
    select * into v_season from seasons where group_id = v_group.id and status = 'active';
    v_opening := v_season.seed_amount;
  else
    v_opening := v_settings.seed_amount;
  end if;

  return query
  select
    (select count(*)::int from memberships m where m.group_id = v_group.id and m.status in ('active', 'dormant')),
    (select count(*)::int from markets mk
       where mk.group_id = v_group.id and mk.status = 'open'
         and not exists (select 1 from market_subjects ms where ms.market_id = mk.id and ms.user_id = v_user_id)),
    (select count(*)::int from markets mk where mk.group_id = v_group.id and mk.status = 'resolved'),
    v_group.created_at,
    v_opening,
    v_settings.resolution_window_hours,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'user_id', f.user_id,
        'initial', f.initial,
        'avatar_updated_at', f.avatar_updated_at,
        'avatar_preset_key', f.avatar_preset_key
      ) order by f.joined_at)
      from (
        select m.user_id, left(m.nickname::text, 1) as initial, u.avatar_updated_at, u.avatar_preset_key, m.joined_at
        from memberships m
        join users u on u.id = m.user_id
        where m.group_id = v_group.id and m.status in ('active', 'dormant')
        order by m.joined_at
        limit 4
      ) f
    ), '[]'::jsonb);
end;
$$;

revoke execute on function get_invite_details(text) from public;
revoke execute on function get_invite_details(text) from anon;
grant execute on function get_invite_details(text) to authenticated;

-- is_invite_nickname_free: 5d's "Handle @danny  Free" pill. join_group()
-- already rejects a taken nickname, but only after the joiner taps Join;
-- the mock checks as they type. Keyed on the invite code, not a group id,
-- because a not-yet-member has no business holding the group's id as an
-- input, and so the lookup sits behind the same miss counter as every other
-- invite-code path. Same uniqueness rule as join_group() and
-- memberships_group_nickname_unique (case-insensitive via citext, ignoring
-- removed/left rows). Returns NULL for a malformed nickname (the client shows
-- the format hint instead) and for an unknown code.
create function is_invite_nickname_free(p_invite_code text, p_nickname citext)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group_id uuid;
begin
  perform _enforce_invite_code_rate_limit();

  select id into v_group_id from groups where invite_code = p_invite_code::citext;
  if v_group_id is null then
    perform _record_invite_code_miss();
    return null;
  end if;

  if p_nickname is null or p_nickname::text !~ '^[A-Za-z0-9_]{1,20}$' then
    return null;
  end if;

  return not exists (
    select 1 from memberships
    where group_id = v_group_id and nickname = p_nickname and status not in ('removed', 'left')
      and user_id <> auth.uid()
  );
end;
$$;

revoke execute on function is_invite_nickname_free(text, citext) from public;
revoke execute on function is_invite_nickname_free(text, citext) from anon;
grant execute on function is_invite_nickname_free(text, citext) to authenticated;

-- get_invite_code_preview (5o, signed out) gains created_at for its "8 members
-- · running 14 weeks" line. A group's age says nothing about what's in it.
-- Still no market content. Return shape changes, so drop and recreate.
drop function if exists get_invite_code_preview(text);

create function get_invite_code_preview(p_invite_code text)
returns table (group_name citext, avatar_key text, member_count int, created_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group groups%rowtype;
begin
  perform _enforce_invite_code_ip_rate_limit();

  select * into v_group from groups where invite_code = p_invite_code::citext;

  if v_group.id is null then
    perform _record_invite_code_ip_miss();
    return;
  end if;

  return query
  select v_group.name, v_group.avatar_key, count(*)::int, v_group.created_at
  from memberships m
  where m.group_id = v_group.id and m.status in ('active', 'dormant');
end;
$$;

revoke execute on function get_invite_code_preview(text) from public;
revoke execute on function get_invite_code_preview(text) from authenticated;
grant execute on function get_invite_code_preview(text) to anon;
