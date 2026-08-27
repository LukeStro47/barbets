-- rename_season, redeclared from 20260811140000_token_allocation_and_season_name_caps.sql
-- with the cap tightened from 60 to 15: the name now has to fit next to "Season N" in the
-- settings header line without wrapping or truncating badly. Same 2-parameter signature.
create or replace function rename_season(p_season_id uuid, p_name text)
returns seasons
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_season seasons%rowtype;
  v_owner_id uuid;
  v_clean text;
begin
  select * into v_season from seasons where id = p_season_id for update;
  if v_season.id is null then
    raise exception 'not_found: season not found';
  end if;

  perform 1 from memberships where group_id = v_season.group_id and user_id = v_caller and status <> 'removed';
  if not found then
    raise exception 'not_found: season not found';
  end if;

  select owner_id into v_owner_id from groups where id = v_season.group_id;
  if v_caller <> v_owner_id then
    raise exception 'forbidden: only the group owner can rename a season';
  end if;

  v_clean := nullif(trim(p_name), '');
  if v_clean is not null and length(v_clean) > 15 then
    raise exception 'invalid_operation: season name must be 15 characters or fewer';
  end if;

  update seasons set name = v_clean where id = p_season_id returning * into v_season;

  return v_season;
end;
$$;
