-- Photo proof on resolution proposals: an optional photo attached at
-- proposal time that stays on the market forever, including through a
-- challenge/vote and past resolution (subject to the usual visibility gate
-- for pre-resolution states). Not shown for voided markets — a void means
-- the group never settled on what actually happened, so there's nothing for
-- the photo to be proof of.
alter table resolution_proposals add column photo_path text;

-- Adding a trailing default param changes propose_resolution's argument
-- *type* signature, which does not replace the existing overload (see the
-- architecture doc's note on this — it's bitten this project before). Drop
-- the superseded 5-arg version explicitly in this same migration.
drop function if exists propose_resolution(uuid, market_outcome, text, numeric, uuid);

create or replace function propose_resolution(
  p_market_id uuid,
  p_outcome market_outcome,
  p_justification text default null,
  p_actual_value numeric default null,
  p_option_id uuid default null,
  p_photo_path text default null
) returns resolution_proposals
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_market markets%rowtype;
  v_proposal resolution_proposals%rowtype;
begin
  select * into v_market from markets where id = p_market_id for update;
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

  insert into resolution_proposals (market_id, proposer_id, proposed_outcome, justification, actual_value, proposed_option_id, photo_path)
  values (p_market_id, v_user_id, p_outcome, p_justification, p_actual_value, p_option_id, p_photo_path)
  returning * into v_proposal;

  update markets
  set status = 'proposed', closed_at = coalesce(closed_at, now())
  where id = p_market_id;

  perform _emit_notification_event('resolution_proposed', v_market.group_id, p_market_id, null, v_user_id);

  return v_proposal;
end;
$$;

revoke execute on function propose_resolution(uuid, market_outcome, text, numeric, uuid, text) from public;
grant execute on function propose_resolution(uuid, market_outcome, text, numeric, uuid, text) to authenticated;

-- Private bucket for proof photos. Deliberately no storage.objects RLS
-- policies at all: with RLS enabled and zero policies, both anon and
-- authenticated are denied by default, matching the rest of this project's
-- "no client-facing mutation policy" posture. Every read and write goes
-- through a Server Action using the service-role client, which re-checks
-- the same visibility rule (via resolution_proposals/visible_markets RLS,
-- evaluated as the requesting user) before ever touching storage — so
-- there's exactly one place, not two, that decides who can see a photo.
insert into storage.buckets (id, name, public)
values ('resolution-proofs', 'resolution-proofs', false)
on conflict (id) do nothing;
