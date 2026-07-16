-- Clarification questions shouldn't linger as history once the creator has
-- addressed them — every row in resolution_clarifications now represents a
-- currently-open question, full stop, so answered_at is dead weight.
alter table resolution_clarifications drop column answered_at;

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

  if v_user_id <> v_market.creator_id then
    raise exception 'forbidden: only the market creator can update the resolution criteria';
  end if;

  if v_market.status <> 'open' then
    raise exception 'invalid_operation: can only update resolution criteria while betting is open';
  end if;

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
