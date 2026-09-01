-- 20260830300000 (multiple_choice widening) rewrote _create_system_market's two insert
-- statements and dropped is_system_market from both column lists, so every market either branch
-- created since then silently took the column's own default (false) instead of true. That flag is
-- the only thing that stops expire_stale()'s zero-bet auto-void sweep from voiding a brand-new
-- Sports/Weather market the instant it closes, before its own resolve Edge Function ever gets a
-- chance to see it (see 20260828100000_system_markets_resolve_without_bets.sql). In production
-- this silently voided a full morning's worth of Weather markets (all six, zero bets, voided
-- within a second of closes_at) on 2026-08-31 -- the pipeline itself reported success the whole
-- time, since it only ever checks the RPC call for an error, and there wasn't one.
--
-- Same signature as 20260830300000's version, so a plain CREATE OR REPLACE is correct per this
-- project's function-change rule -- only the two insert statements' column lists change.
create or replace function _create_system_market(
  p_group_id uuid,
  p_title text,
  p_description text,
  p_market_type market_type,
  p_closes_at timestamptz,
  p_line numeric default null,
  p_unit text default null,
  p_options text[] default null
) returns markets
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group groups%rowtype;
  v_title text;
  v_unit text;
  v_market markets%rowtype;
  v_pending_bonus int;
  v_option_count int;
  v_idx int;
begin
  select * into v_group from groups where id = p_group_id;
  if v_group.id is null or not v_group.is_public then
    raise exception 'invalid_operation: system markets can only be created in a public group';
  end if;

  if v_group.deletion_scheduled_at is not null then
    raise exception 'invalid_operation: this group is scheduled for deletion and can''t start new markets';
  end if;

  if p_market_type not in ('yes_no', 'over_under', 'multiple_choice') then
    raise exception 'invalid_operation: system markets support yes_no, over_under, or multiple_choice only';
  end if;

  v_title := nullif(trim(p_title), '');
  if v_title is null then
    raise exception 'invalid_operation: market title can''t be blank';
  end if;
  if length(v_title) > 140 then
    raise exception 'invalid_operation: market title must be 140 characters or fewer';
  end if;

  if p_closes_at <= now() then
    raise exception 'invalid_operation: closes_at must be in the future';
  end if;

  v_unit := nullif(trim(coalesce(p_unit, '')), '');
  if v_unit is not null then
    if p_market_type <> 'over_under' then
      raise exception 'invalid_operation: a unit only applies to over/under markets';
    end if;
    if length(v_unit) > 10 then
      raise exception 'invalid_operation: unit must be 10 characters or fewer';
    end if;
  end if;

  if p_market_type = 'multiple_choice' then
    v_option_count := coalesce(array_length(p_options, 1), 0);
    if v_option_count < 2 or v_option_count > 10 then
      raise exception 'invalid_operation: multiple choice markets need between 2 and 10 options';
    end if;

    if exists (select 1 from unnest(p_options) as o where trim(o) = '') then
      raise exception 'invalid_operation: option labels cannot be blank';
    end if;

    if exists (select 1 from unnest(p_options) as o where length(trim(o)) > 40) then
      raise exception 'invalid_operation: option labels must be 40 characters or fewer';
    end if;

    if (select count(distinct trim(o)) from unnest(p_options) as o) <> v_option_count then
      raise exception 'invalid_operation: option labels must be unique';
    end if;

    insert into markets (group_id, season_id, title, description, market_type, line, creator_id, closes_at, unit, status, is_system_market)
    values (p_group_id, null, v_title, p_description, p_market_type, null, null, p_closes_at, null, 'open', true)
    returning * into v_market;

    for v_idx in 1 .. v_option_count loop
      insert into market_options (market_id, label, sort_order)
      values (v_market.id, trim(p_options[v_idx]), v_idx);
    end loop;
  else
    insert into markets (group_id, season_id, title, description, market_type, line, creator_id, closes_at, unit, status, is_system_market)
    values (p_group_id, null, v_title, p_description, p_market_type, p_line, null, p_closes_at, v_unit, 'open', true)
    returning * into v_market;
  end if;

  select pending_bonus_pool into v_pending_bonus from groups where id = p_group_id for update;
  if v_pending_bonus > 0 then
    update markets set bonus_pool = v_pending_bonus, carried_bonus_pool = v_pending_bonus where id = v_market.id
    returning * into v_market;
    update groups set pending_bonus_pool = 0 where id = p_group_id;
  end if;

  perform _emit_notification_event('market_opened', p_group_id, v_market.id, null, null);

  return v_market;
end;
$$;

revoke execute on function _create_system_market(uuid, text, text, market_type, timestamptz, numeric, text, text[]) from public;
revoke execute on function _create_system_market(uuid, text, text, market_type, timestamptz, numeric, text, text[]) from authenticated;
grant execute on function _create_system_market(uuid, text, text, market_type, timestamptz, numeric, text, text[]) to service_role;
