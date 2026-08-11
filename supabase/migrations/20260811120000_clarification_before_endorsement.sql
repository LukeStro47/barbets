-- Lets the clarification conversation start one stage earlier: on a market
-- that is still `pending_sponsor`, not just one that is already `open`.
--
-- The endorsement screen's whole job is "a second member checks the question
-- is fair and unambiguous before betting opens." Refusing to let that member
-- ask what a vague criterion means until *after* they have vouched for it
-- inverts the point of the gate — the only options were endorse it anyway or
-- walk away, and neither gets the wording fixed. Widening both halves of the
-- exchange (ask, and answer) to `pending_sponsor` is what makes the endorse
-- screen's "Ask for a clarification" panel a real third option.
--
-- Everything else about the pair is deliberately unchanged: still non-creator
-- only to ask, still creator-only to answer, still requires a pending row to
-- answer against (so `update_resolution_criteria` stays strictly reactive and
-- never becomes a free edit), still deletes/answers every pending row at once,
-- and both still reject every later status outright. Signatures are identical,
-- so `create or replace` genuinely replaces rather than adding an overload.

create or replace function request_clarification(p_market_id uuid, p_question text)
returns resolution_clarifications
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_market markets%rowtype;
  v_row resolution_clarifications%rowtype;
begin
  select * into v_market from markets where id = p_market_id;
  if v_market.id is null then
    raise exception 'not_found: market not found';
  end if;

  if exists (select 1 from market_subjects where market_id = p_market_id and user_id = v_user_id) then
    raise exception 'not_found: market not found';
  end if;

  perform 1 from memberships where group_id = v_market.group_id and user_id = v_user_id and status <> 'removed';
  if not found then
    raise exception 'not_found: not a member of this group';
  end if;

  if v_market.status not in ('open', 'pending_sponsor') then
    raise exception 'invalid_operation: can only ask for clarification before betting closes';
  end if;

  if v_user_id = v_market.creator_id then
    raise exception 'invalid_operation: you created this market, you can edit the criteria directly';
  end if;

  if p_question is null or length(trim(p_question)) = 0 then
    raise exception 'invalid_operation: question cannot be empty';
  end if;

  insert into resolution_clarifications (market_id, requester_id, question)
  values (p_market_id, v_user_id, trim(p_question))
  returning * into v_row;

  perform _emit_notification_event('clarification_requested', v_market.group_id, p_market_id, null, v_user_id);

  return v_row;
end;
$$;

revoke execute on function request_clarification(uuid, text) from public;
grant execute on function request_clarification(uuid, text) to authenticated;

create or replace function update_resolution_criteria(p_market_id uuid, p_description text)
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

  perform 1 from memberships where group_id = v_market.group_id and user_id = v_user_id and status <> 'removed';
  if not found then
    raise exception 'not_found: not a member of this group';
  end if;

  -- Plain authorization check, not subject-masking: the creator can never
  -- be a subject of their own market (enforced in create_market), so there
  -- is nothing to 404-mask here. Mirrors end_season's owner-only check.
  if v_user_id <> v_market.creator_id then
    raise exception 'forbidden: only the market creator can update the resolution criteria';
  end if;

  if v_market.status not in ('open', 'pending_sponsor') then
    raise exception 'invalid_operation: can only update resolution criteria before betting closes';
  end if;

  -- Every row in this table is pending by construction (answered_at was dropped
  -- in 20260716130000; the delete below is what "answered" means now).
  if not exists (select 1 from resolution_clarifications where market_id = p_market_id) then
    raise exception 'invalid_operation: no pending clarification request to respond to';
  end if;

  if p_description is null or length(trim(p_description)) = 0 then
    raise exception 'invalid_operation: resolution criteria cannot be empty';
  end if;

  update markets set description = trim(p_description) where id = p_market_id
  returning * into v_market;

  delete from resolution_clarifications where market_id = p_market_id;

  perform _emit_notification_event('criteria_updated', v_market.group_id, p_market_id, null, v_user_id);

  return v_market;
end;
$$;

revoke execute on function update_resolution_criteria(uuid, text) from public;
grant execute on function update_resolution_criteria(uuid, text) to authenticated;
