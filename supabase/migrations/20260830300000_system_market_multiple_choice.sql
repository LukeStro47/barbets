-- Sports moneyline markets move from yes_no ("YES means the {home} win") to multiple_choice
-- (one option per team) -- see sports-create-markets/index.ts's header comment for why yes_no
-- stopped working the moment the title itself changed from a question ("Will the {home} beat the
-- {away}?") to a neutral "{home} vs. {away}": MarketExplainer's yes_no branch renders nothing at
-- all ("the question is the explanation"), so a bettor saw a team-vs-team title with bare Yes/No
-- buttons and no way to tell which team either one meant short of scrolling to the resolution
-- criteria card. multiple_choice with two options (each team's own name) sidesteps the whole
-- problem instead of trying to patch it: OptionsTicket already renders every option's label as its
-- own backable row, so "Chicago Cubs" / "St. Louis Cardinals" is self-explanatory the same way the
-- old question-phrased title was, with no explainer card to add back.
--
-- Both functions are widened rather than replaced with multiple_choice-only siblings, since a
-- system market with exactly two options is still just a system market -- yes_no/over_under stay
-- fully supported for Weather (and anything else that reaches for this pair later). Per this
-- project's function-change rule, both old signatures are dropped explicitly rather than relying
-- on CREATE OR REPLACE to widen them in place -- a same-named function with a new trailing
-- parameter is a second overload, not a replacement, and PostgREST can't pick between them.
drop function if exists _create_system_market(uuid, text, text, market_type, timestamptz, numeric, text);

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

    insert into markets (group_id, season_id, title, description, market_type, line, creator_id, closes_at, unit, status)
    values (p_group_id, null, v_title, p_description, p_market_type, null, null, p_closes_at, null, 'open')
    returning * into v_market;

    for v_idx in 1 .. v_option_count loop
      insert into market_options (market_id, label, sort_order)
      values (v_market.id, trim(p_options[v_idx]), v_idx);
    end loop;
  else
    insert into markets (group_id, season_id, title, description, market_type, line, creator_id, closes_at, unit, status)
    values (p_group_id, null, v_title, p_description, p_market_type, p_line, null, p_closes_at, v_unit, 'open')
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

-- _resolve_system_market widens the same way: p_option_id (default null) resolves a
-- multiple_choice system market to a specific option, mirroring propose_resolution()'s own
-- outcome-XOR-option convention. p_outcome drops its NOT NULL default too (a multiple_choice win
-- passes p_option_id and leaves p_outcome out of the call entirely), which changes nothing for
-- existing yes_no/over_under callers since PostgREST already sends NULL for any omitted key
-- regardless of a SQL-side default.
drop function if exists _resolve_system_market(uuid, market_outcome, numeric);

create or replace function _resolve_system_market(
  p_market_id uuid,
  p_outcome market_outcome default null,
  p_actual_value numeric default null,
  p_option_id uuid default null
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

  if v_market.market_type = 'multiple_choice' then
    if p_option_id is not null then
      if p_outcome is not null then
        raise exception 'invalid_operation: propose an option or VOID, not both';
      end if;
      perform 1 from market_options where id = p_option_id and market_id = p_market_id;
      if not found then
        raise exception 'invalid_operation: option does not belong to this market';
      end if;
    elsif p_outcome is distinct from 'void' then
      raise exception 'invalid_operation: outcome does not match market type';
    end if;
  else
    if p_option_id is not null then
      raise exception 'invalid_operation: this market does not use options';
    end if;
    if (v_market.market_type = 'yes_no' and p_outcome not in ('yes', 'no', 'void'))
       or (v_market.market_type = 'over_under' and p_outcome not in ('over', 'under', 'void')) then
      raise exception 'invalid_operation: outcome does not match market type';
    end if;
  end if;

  if p_actual_value is not null and v_market.market_type <> 'over_under' then
    raise exception 'invalid_operation: actual_value only applies to over/under markets';
  end if;

  insert into resolution_proposals (market_id, proposer_id, proposed_outcome, actual_value, proposed_option_id)
  values (p_market_id, null, p_outcome, p_actual_value, p_option_id);

  update markets
  set status = 'proposed', closed_at = coalesce(closed_at, now())
  where id = p_market_id;

  perform _emit_notification_event('resolution_proposed', v_market.group_id, p_market_id, null, null);

  return finalize_market(p_market_id);
end;
$$;

revoke execute on function _resolve_system_market(uuid, market_outcome, numeric, uuid) from public;
revoke execute on function _resolve_system_market(uuid, market_outcome, numeric, uuid) from authenticated;
grant execute on function _resolve_system_market(uuid, market_outcome, numeric, uuid) to service_role;
