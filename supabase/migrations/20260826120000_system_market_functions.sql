-- _create_system_market / _resolve_system_market: the actor-less pair the Sports/Weather
-- auto-generated market pipelines call from a service-role Edge Function, with no human on
-- either side. Follows the same split _end_season() established for the cron-callable case
-- (ARCHITECTURE.md's "a SECURITY DEFINER function that reads auth.uid() cannot be called by
-- cron" lesson): no auth.uid() read anywhere in the body, revoked from public AND authenticated,
-- granted only to service_role. There is no client-facing wrapper — nothing but the pipelines'
-- own Edge Functions ever needs to call these.
--
-- Scoped to yes_no/over_under only (moneyline sports markets, rain/temperature weather
-- markets). multiple_choice isn't needed for anything scoped so far and is left out rather than
-- half-built.
--
-- Strips everything create_market()/propose_resolution() do that doesn't apply to a system
-- market: no membership/mod-or-owner check (there's no caller), no subject-cap math (a system
-- market never has subjects), no require_endorsement branching (always inserts status='open',
-- same as every public-group market already does), no season gate (public groups never have
-- seasons_enabled). Still checks the group is actually public and not scheduled for deletion —
-- this function must never be pointed at a private group.
--
-- creator_id = NULL is safe: nullable since 20260823100000, no CHECK constraint blocks it, and
-- the creator-cut branch in _finalize_market_core() never executes for a public-group market
-- regardless (creator_payout_pct is forced 0 there) — see markets.creator_id's read sites for
-- the one place this needed an actual fix (the reveal page's "Started by" line).
create or replace function _create_system_market(
  p_group_id uuid,
  p_title text,
  p_description text,
  p_market_type market_type,
  p_closes_at timestamptz,
  p_line numeric default null,
  p_unit text default null
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
begin
  select * into v_group from groups where id = p_group_id;
  if v_group.id is null or not v_group.is_public then
    raise exception 'invalid_operation: system markets can only be created in a public group';
  end if;

  if v_group.deletion_scheduled_at is not null then
    raise exception 'invalid_operation: this group is scheduled for deletion and can''t start new markets';
  end if;

  if p_market_type not in ('yes_no', 'over_under') then
    raise exception 'invalid_operation: system markets support yes_no or over_under only';
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

  insert into markets (group_id, season_id, title, description, market_type, line, creator_id, closes_at, unit, status)
  values (p_group_id, null, v_title, p_description, p_market_type, p_line, null, p_closes_at, v_unit, 'open')
  returning * into v_market;

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

revoke execute on function _create_system_market(uuid, text, text, market_type, timestamptz, numeric, text) from public;
revoke execute on function _create_system_market(uuid, text, text, market_type, timestamptz, numeric, text) from authenticated;
grant execute on function _create_system_market(uuid, text, text, market_type, timestamptz, numeric, text) to service_role;

-- Mirrors propose_resolution()'s outcome validation minus the auth.uid()/membership gate, then
-- finalizes directly: a system market only ever lives in a public group, which always
-- instant-finalizes (same call shape propose_resolution() already uses for is_public groups),
-- so there's no separate "wait for the challenge window" path to consider here.
create or replace function _resolve_system_market(
  p_market_id uuid,
  p_outcome market_outcome,
  p_actual_value numeric default null
) returns markets
language plpgsql
security definer
set search_path = public
as $$
declare
  v_market markets%rowtype;
  v_is_public boolean;
begin
  select * into v_market from markets where id = p_market_id for update;
  if v_market.id is null then
    raise exception 'not_found: market not found';
  end if;

  select is_public into v_is_public from groups where id = v_market.group_id;
  if not v_is_public then
    raise exception 'invalid_operation: system markets can only be resolved in a public group';
  end if;

  if v_market.status not in ('open', 'closed') then
    raise exception 'invalid_operation: market is not awaiting a resolution proposal';
  end if;

  if (v_market.market_type = 'yes_no' and p_outcome not in ('yes', 'no', 'void'))
     or (v_market.market_type = 'over_under' and p_outcome not in ('over', 'under', 'void')) then
    raise exception 'invalid_operation: outcome does not match market type';
  end if;

  if p_actual_value is not null and v_market.market_type <> 'over_under' then
    raise exception 'invalid_operation: actual_value only applies to over/under markets';
  end if;

  insert into resolution_proposals (market_id, proposer_id, proposed_outcome, actual_value)
  values (p_market_id, null, p_outcome, p_actual_value);

  update markets
  set status = 'proposed', closed_at = coalesce(closed_at, now())
  where id = p_market_id;

  perform _emit_notification_event('resolution_proposed', v_market.group_id, p_market_id, null, null);

  return finalize_market(p_market_id);
end;
$$;

revoke execute on function _resolve_system_market(uuid, market_outcome, numeric) from public;
revoke execute on function _resolve_system_market(uuid, market_outcome, numeric) from authenticated;
grant execute on function _resolve_system_market(uuid, market_outcome, numeric) to service_role;
