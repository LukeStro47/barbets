-- Bug found via real usage: a 3-member group couldn't @mention anyone at
-- all ("max 0 subjects for a group this size"). The cap was requiring 3
-- non-subject members left over (creator + endorser + a separate bettor),
-- but nothing in place_bet() actually stops the creator or sponsor from
-- betting on their own market — they're regular members with a balance
-- like anyone else. Only 2 non-subject members are actually required (a
-- creator and a different person to endorse); both can bet too. So the cap
-- loosens from member_count - 3 to member_count - 2.
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

    if array_length(v_subject_ids, 1) >= v_member_count - 1 then
      raise exception 'invalid_operation: this group has % members, so a market can have at most % subject(s) — enough people need to be left to create and endorse it', v_member_count, greatest(v_member_count - 2, 0);
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

  perform _emit_notification_event('market_needs_endorsement', p_group_id, v_market.id, null, v_user_id);

  return v_market;
end;
$$;

revoke execute on function create_market(uuid, text, text, market_type, timestamptz, numeric, uuid[]) from public;
grant execute on function create_market(uuid, text, text, market_type, timestamptz, numeric, uuid[]) to authenticated;
