-- create_market: creator must be a current (non-removed) member. Subjects
-- (if any) must each be *active* members — dormant members can't be @'d,
-- matching place_bet's "dormant members can't bet" restriction; both are
-- read as consequences of "dormant... can't bet or be @'d" in the spec.
-- Enforces: creator not a subject, subject count < (member count - 2), no
-- duplicate subjects, and (when seasons are enabled) that the group is
-- actually mid-season, not between seasons.
create or replace function create_market(
  p_group_id uuid,
  p_title text,
  p_description text,
  p_market_type market_type,
  p_closes_at timestamptz,
  p_line numeric default null,
  p_subject_user_ids uuid[] default '{}'
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
begin
  perform 1 from memberships where group_id = p_group_id and user_id = v_user_id and status <> 'removed';
  if not found then
    raise exception 'not_found: not a member of this group';
  end if;

  if p_closes_at <= now() then
    raise exception 'invalid_operation: closes_at must be in the future';
  end if;

  select * into v_settings from group_settings where group_id = p_group_id;
  if v_settings.seasons_enabled then
    select id into v_season_id from seasons where group_id = p_group_id and status = 'active';
    if v_season_id is null then
      raise exception 'invalid_operation: the group is between seasons — wait for the new season to start';
    end if;
  end if;

  select array_agg(distinct x) into v_subject_ids from unnest(p_subject_user_ids) as x;

  if v_subject_ids is not null and v_user_id = any(v_subject_ids) then
    raise exception 'invalid_operation: the creator cannot be a subject of their own market';
  end if;

  if v_subject_ids is not null then
    select count(*) into v_member_count from memberships where group_id = p_group_id and status <> 'removed';

    if array_length(v_subject_ids, 1) >= v_member_count - 2 then
      raise exception 'invalid_operation: too many subjects — a market needs at least a creator, a sponsor, and a bettor outside its subjects';
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

  return v_market;
end;
$$;

revoke execute on function create_market(uuid, text, text, market_type, timestamptz, numeric, uuid[]) from public;
grant execute on function create_market(uuid, text, text, market_type, timestamptz, numeric, uuid[]) to authenticated;

-- sponsor_market: a subject calling this on a market about them gets the
-- same 'not_found' as anyone hitting a hidden market URL — this function
-- bypasses RLS (SECURITY DEFINER) so it must re-check subject exclusion
-- itself rather than relying on the caller having been unable to see the
-- market in the first place.
create or replace function sponsor_market(p_market_id uuid)
returns markets
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_market markets%rowtype;
begin
  select * into v_market from markets where id = p_market_id for update;
  if v_market.id is null then
    raise exception 'not_found: market not found';
  end if;

  if exists (select 1 from market_subjects where market_id = p_market_id and user_id = v_user_id) then
    raise exception 'not_found: market not found';
  end if;

  if v_market.status <> 'pending_sponsor' then
    raise exception 'invalid_operation: market is already sponsored or has expired';
  end if;

  if v_user_id = v_market.creator_id then
    raise exception 'invalid_operation: the creator cannot sponsor their own market';
  end if;

  perform 1 from memberships where group_id = v_market.group_id and user_id = v_user_id and status <> 'removed';
  if not found then
    raise exception 'not_found: not a member of this group';
  end if;

  update markets set sponsor_id = v_user_id, status = 'open'
  where id = p_market_id
  returning * into v_market;

  return v_market;
end;
$$;

revoke execute on function sponsor_market(uuid) from public;
grant execute on function sponsor_market(uuid) to authenticated;
