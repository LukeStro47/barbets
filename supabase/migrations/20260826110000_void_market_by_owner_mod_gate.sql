-- void_market_by_owner: extend the authority gate for public groups the same
-- way remove_member() and update_group_settings() already were -- a
-- moderator can void a bad auto-generated (or hand-created) market without
-- needing full owner access. Private-group behavior is unchanged, still
-- owner-only. This was Phase 1's one missed spot: every other public-group
-- mod-safety-valve action got this treatment already, this one didn't.
create or replace function void_market_by_owner(p_market_id uuid)
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

  -- 404-not-403: an owner who happens to be this market's subject still
  -- can't act on a market they're not supposed to know exists.
  if exists (select 1 from market_subjects where market_id = p_market_id and user_id = v_caller) then
    raise exception 'not_found: market not found';
  end if;

  select * into v_group from groups where id = v_market.group_id;

  if v_group.is_public then
    if not _is_group_mod_or_owner(v_group.id, v_caller) then
      raise exception 'forbidden: only a moderator can void a market here';
    end if;
  else
    if v_caller <> v_group.owner_id then
      raise exception 'forbidden: only the group owner can void a market';
    end if;
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

revoke execute on function void_market_by_owner(uuid) from public;
grant execute on function void_market_by_owner(uuid) to authenticated;
