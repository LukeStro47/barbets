-- void_market_by_creator: the fallback void_market_by_owner can never cover.
-- If the group owner is @mentioned as a subject of a market, is_market_visible
-- hides that market from them entirely, so they can never call the
-- owner-only kill switch on it (void_market_by_owner 404s them before it
-- even checks ownership, same 404-not-403 pattern used everywhere a subject
-- touches a market they're hidden from). Every other stuck-market path still
-- resolves eventually: a normal member vote can VOID it with no owner
-- involvement, or end_season() force-voids everything unconditionally — but
-- neither is available on demand the way the owner's kill switch is. This
-- gives the market's creator (who can never themselves be a subject, by
-- create_market's own constraint) an equivalent on-demand override, strictly
-- limited to this one scenario: it 404s like every other subject-adjacent
-- function, and it refuses outright (invalid_operation, not a silent no-op)
-- if the owner isn't actually a subject of this market, since the owner is
-- still meant to be the one calling the shots whenever they're able to.
create or replace function void_market_by_creator(p_market_id uuid)
returns markets
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_market markets%rowtype;
  v_group groups%rowtype;
begin
  select * into v_market from markets where id = p_market_id for update;
  if v_market.id is null then
    raise exception 'not_found: market not found';
  end if;

  if exists (select 1 from market_subjects where market_id = p_market_id and user_id = v_caller) then
    raise exception 'not_found: market not found';
  end if;

  if v_caller <> v_market.creator_id then
    raise exception 'forbidden: only this market''s creator can use this fallback';
  end if;

  select * into v_group from groups where id = v_market.group_id;

  if not exists (select 1 from market_subjects where market_id = p_market_id and user_id = v_group.owner_id) then
    raise exception 'invalid_operation: only the group owner can void this market';
  end if;

  if v_market.status in ('resolved', 'voided') then
    raise exception 'invalid_operation: this market has already been settled';
  end if;

  perform refund_all_bets(p_market_id);

  update resolution_proposals set finalized = true where market_id = p_market_id;

  update markets
  set status = 'voided', outcome = 'void', outcome_option_id = null, resolved_at = now()
  where id = p_market_id
  returning * into v_market;

  perform _emit_notification_event('market_voided', v_market.group_id, v_market.id, null, v_caller);

  return v_market;
end;
$$;

revoke execute on function void_market_by_creator(uuid) from public;
grant execute on function void_market_by_creator(uuid) to authenticated;
