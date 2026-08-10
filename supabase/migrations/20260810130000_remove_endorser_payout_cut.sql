-- Removes the endorser's cut of a universal-loss ("nobody predicted this")
-- pool entirely. The setting was always two numbers where one would do: the
-- creator's share is the only one anyone actually reasoned about, and the
-- endorser's 5% default rewarded a role that costs one tap and carries no
-- risk. What's left after the creator's cut now goes, in full, where it was
-- already mostly going: the group's other open markets (or groups.pending_
-- bonus_pool when there are none). The settings UI states that remainder as a
-- read-only figure derived from the creator %, so the two numbers can't drift
-- out of sync or be made to sum past 100 in the first place.
--
-- markets.payout_breakdown keeps its 'endorser_cut' key, written as 0 from
-- here on. Already-resolved markets have real values in theirs and the reveal
-- page still renders them honestly; dropping the key would have made those
-- historical rows unreadable to a UI that no longer knew to look for it.
alter table group_settings drop column endorser_payout_pct;

-- Per ARCHITECTURE.md's documented overload gotcha: this drops a parameter
-- rather than adding one, but the rule is the same either way — the superseded
-- signature is dropped explicitly in the same migration, never left for
-- CREATE OR REPLACE to orphan alongside the new one.
drop function if exists update_group_settings(uuid, int, boolean, season_length, text, boolean, boolean, boolean, int, int, boolean, timestamptz, numeric, boolean);

create function update_group_settings(
  p_group_id uuid,
  p_seed_amount int,
  p_seasons_enabled boolean,
  p_season_length season_length default null,
  p_timezone text default 'UTC',
  p_betting_enabled boolean default false,
  p_accepting_members boolean default true,
  p_distribute_payout boolean default false,
  p_creator_payout_pct int default 25,
  p_allow_hedged_bets boolean default true,
  p_season_custom_ends_at timestamptz default null,
  p_resolution_window_hours numeric default 8,
  p_require_endorsement boolean default true
) returns group_settings
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_group groups%rowtype;
  v_settings group_settings%rowtype;
  v_was_betting_enabled boolean;
  v_ends_at timestamptz;
begin
  select * into v_group from groups where id = p_group_id;
  if v_group.id is null then
    raise exception 'not_found: group not found';
  end if;

  perform 1 from memberships where group_id = p_group_id and user_id = v_caller and status <> 'removed';
  if not found then
    raise exception 'not_found: group not found';
  end if;

  if v_caller <> v_group.owner_id then
    raise exception 'forbidden: only the group owner can edit settings';
  end if;

  if not exists (select 1 from pg_timezone_names where name = p_timezone) then
    raise exception 'invalid_operation: unrecognized time zone';
  end if;

  if p_creator_payout_pct < 0 or p_creator_payout_pct > 100 then
    raise exception 'invalid_operation: the creator percentage must be between 0 and 100';
  end if;

  if p_resolution_window_hours < 0.5 or p_resolution_window_hours > 10 then
    raise exception 'invalid_operation: the challenge/resolution window must be between 0.5 and 10 hours';
  end if;
  if p_resolution_window_hours * 2 <> floor(p_resolution_window_hours * 2) then
    raise exception 'invalid_operation: the challenge/resolution window must be in half-hour steps';
  end if;

  if p_seasons_enabled and p_season_length = 'custom' and (p_season_custom_ends_at is null or p_season_custom_ends_at <= now()) then
    raise exception 'invalid_operation: pick a custom season end date in the future';
  end if;

  select * into v_settings from group_settings where group_id = p_group_id;
  v_was_betting_enabled := v_settings.betting_enabled;

  if v_settings.seasons_enabled and not p_seasons_enabled then
    raise exception 'invalid_operation: seasons cannot be turned off once enabled';
  end if;

  if v_was_betting_enabled and not p_betting_enabled then
    raise exception 'invalid_operation: betting cannot be turned off once enabled, end the season instead to pause things';
  end if;

  update group_settings
  set seed_amount = p_seed_amount,
      seasons_enabled = p_seasons_enabled,
      season_length = p_season_length,
      timezone = p_timezone,
      betting_enabled = p_betting_enabled,
      accepting_members = p_accepting_members,
      distribute_payout = p_distribute_payout,
      creator_payout_pct = p_creator_payout_pct,
      allow_hedged_bets = p_allow_hedged_bets,
      season_custom_ends_at = p_season_custom_ends_at,
      resolution_window_hours = p_resolution_window_hours,
      require_endorsement = p_require_endorsement
  where group_id = p_group_id
  returning * into v_settings;

  if p_seasons_enabled and not exists (select 1 from seasons where group_id = p_group_id) then
    v_ends_at := _compute_season_ends_at(p_season_length, p_season_custom_ends_at, now());
    insert into seasons (group_id, number, status, seed_amount, ends_at, season_length, betting_open)
    values (p_group_id, 1, 'active', p_seed_amount, v_ends_at, p_season_length, false);
  end if;

  if p_betting_enabled and not v_was_betting_enabled then
    perform _emit_notification_event('betting_opened', p_group_id, null, null, v_caller);
  end if;

  return v_settings;
end;
$$;

revoke execute on function update_group_settings(uuid, int, boolean, season_length, text, boolean, boolean, boolean, int, boolean, timestamptz, numeric, boolean) from public;
grant execute on function update_group_settings(uuid, int, boolean, season_length, text, boolean, boolean, boolean, int, boolean, timestamptz, numeric, boolean) to authenticated;

-- _finalize_market_core: identical to 20260721130000's version except the
-- zero-winning-pool branch, which no longer computes or pays an endorser cut.
-- The remainder that used to be reduced by it now flows whole into the other
-- open markets / pending_bonus_pool, so no tokens go missing; payout_breakdown
-- records endorser_cut as a literal 0 (see the note at the top).
create or replace function _finalize_market_core(p_market_id uuid)
returns markets
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_id uuid := auth.uid();
  v_market markets%rowtype;
  v_settings group_settings%rowtype;
  v_proposal resolution_proposals%rowtype;
  v_challenge challenges%rowtype;
  v_outcome market_outcome;
  v_outcome_option_id uuid;
  v_winning_bet_side bet_side;
  v_actual_value numeric;
  v_top_key text;
  v_top_count int;
  v_tied_keys text[];
  v_proposed_key text;
  v_eligible_voters int;
  v_votes_cast int;
  v_total_pool bigint;
  v_winning_pool bigint;
  v_real_pool bigint;
  v_creator_cut bigint;
  v_remainder bigint;
  v_other_markets_cut bigint;
  v_held_in_group_pool bigint;
  v_other_market_ids uuid[];
  v_n int;
  v_share bigint;
  v_dust bigint;
  v_best_bet_id uuid;
  v_best_bet_user_id uuid;
  rec record;
begin
  select * into v_market from markets where id = p_market_id for update;
  if v_market.id is null then
    raise exception 'not_found: market not found';
  end if;

  if v_market.status not in ('proposed', 'disputed') then
    raise exception 'invalid_operation: market is not awaiting finalization';
  end if;

  select * into v_settings from group_settings where group_id = v_market.group_id;

  select * into v_proposal from resolution_proposals where market_id = p_market_id;
  if v_proposal.id is null then
    raise exception 'invalid_operation: no proposal exists for this market';
  end if;

  if v_market.status = 'proposed' then
    if v_proposal.proposed_at + (v_settings.resolution_window_hours * interval '1 hour') > now() then
      raise exception 'invalid_operation: the challenge window is still open';
    end if;
    v_outcome := v_proposal.proposed_outcome;
    v_outcome_option_id := v_proposal.proposed_option_id;
    v_actual_value := v_proposal.actual_value;
  else
    select * into v_challenge from challenges where market_id = p_market_id;

    select count(*) into v_eligible_voters
    from memberships m
    where m.group_id = v_market.group_id
      and m.status <> 'removed'
      and not exists (select 1 from market_subjects ms where ms.market_id = p_market_id and ms.user_id = m.user_id);
    select count(distinct voter_id) into v_votes_cast from votes where market_id = p_market_id;

    if v_challenge.created_at + (v_settings.resolution_window_hours * interval '1 hour') > now() and v_votes_cast < v_eligible_voters then
      raise exception 'invalid_operation: the vote window is still open';
    end if;

    select coalesce(voted_option_id::text, outcome::text), count(*) into v_top_key, v_top_count
    from votes
    where market_id = p_market_id
    group by 1
    order by count(*) desc
    limit 1;

    v_proposed_key := coalesce(v_proposal.proposed_option_id::text, v_proposal.proposed_outcome::text);

    if v_top_count is null or v_top_count = 0 then
      v_top_key := v_proposed_key;
    else
      select array_agg(key) into v_tied_keys
      from (
        select coalesce(voted_option_id::text, outcome::text) as key
        from votes
        where market_id = p_market_id
        group by 1
        having count(*) = v_top_count
      ) ties;

      if array_length(v_tied_keys, 1) > 1 then
        if v_proposed_key = any(v_tied_keys) then
          v_top_key := v_proposed_key;
        else
          v_top_key := 'void';
        end if;
      end if;
    end if;

    if v_top_key = 'void' then
      v_outcome := 'void';
      v_outcome_option_id := null;
    elsif v_market.market_type = 'multiple_choice' then
      v_outcome := null;
      v_outcome_option_id := v_top_key::uuid;
    else
      v_outcome := v_top_key::market_outcome;
      v_outcome_option_id := null;
    end if;

    v_actual_value := v_proposal.actual_value;

    update resolution_proposals set votes_revealed_at = now() where market_id = p_market_id;
  end if;

  update resolution_proposals set finalized = true where market_id = p_market_id;

  if v_outcome = 'void' then
    perform refund_all_bets(p_market_id);
    update markets
    set status = 'voided', outcome = 'void', outcome_option_id = null, actual_value = v_actual_value, resolved_at = now()
    where id = p_market_id
    returning * into v_market;
    perform _emit_notification_event('market_resolved', v_market.group_id, v_market.id, null, v_actor_id);
    return v_market;
  end if;

  v_winning_bet_side := case when v_market.market_type = 'multiple_choice' then null else v_outcome::text::bet_side end;

  select coalesce(sum(amount), 0) into v_total_pool
  from bets where market_id = p_market_id and settled_at is null;

  select coalesce(sum(amount), 0) into v_winning_pool
  from bets
  where market_id = p_market_id and settled_at is null
    and (side = v_winning_bet_side or option_id = v_outcome_option_id);

  if v_winning_pool = 0 then
    if not v_settings.distribute_payout or v_total_pool + v_market.bonus_pool = 0 then
      perform refund_all_bets(p_market_id);
      update markets
      set status = 'resolved', outcome = v_outcome, outcome_option_id = v_outcome_option_id, actual_value = v_actual_value, resolved_at = now()
      where id = p_market_id
      returning * into v_market;
      perform _emit_notification_event('market_resolved', v_market.group_id, v_market.id, null, v_actor_id);
      perform _bump_titles_counter(v_market.group_id);
      return v_market;
    end if;

    v_real_pool := v_total_pool;
    v_creator_cut := floor(v_real_pool::numeric * v_settings.creator_payout_pct / 100)::bigint;
    v_remainder := v_real_pool + v_market.bonus_pool - v_creator_cut;
    v_other_markets_cut := 0;
    v_held_in_group_pool := 0;

    if v_creator_cut > 0 then
      update memberships set balance = balance + v_creator_cut
      where group_id = v_market.group_id and user_id = v_market.creator_id;

      insert into ledger (membership_id, amount, reason, market_id)
      select id, v_creator_cut, 'payout', p_market_id
      from memberships where group_id = v_market.group_id and user_id = v_market.creator_id;
    end if;

    update markets set bonus_pool = 0 where id = p_market_id;

    if v_remainder = 0 then
      update bets set payout = 0, settled_at = now() where market_id = p_market_id and settled_at is null;
    else
      select array_agg(id order by created_at asc, id asc) into v_other_market_ids
      from markets where group_id = v_market.group_id and status = 'open';

      if v_other_market_ids is not null and array_length(v_other_market_ids, 1) > 0 then
        v_other_markets_cut := v_remainder;
        v_n := array_length(v_other_market_ids, 1);
        v_share := floor(v_remainder::numeric / v_n)::bigint;
        v_dust := v_remainder - v_share * v_n;

        update markets
        set bonus_pool = bonus_pool + v_share + (case when id = v_other_market_ids[1] then v_dust else 0 end)
        where id = any(v_other_market_ids);
      else
        v_held_in_group_pool := v_remainder;
        update groups set pending_bonus_pool = pending_bonus_pool + v_remainder where id = v_market.group_id;
      end if;

      update bets set payout = 0, settled_at = now() where market_id = p_market_id and settled_at is null;
    end if;

    update markets
    set status = 'resolved', outcome = v_outcome, outcome_option_id = v_outcome_option_id, actual_value = v_actual_value, resolved_at = now(),
        payout_breakdown = jsonb_build_object(
          'creator_cut', v_creator_cut,
          'endorser_cut', 0,
          'other_markets_cut', v_other_markets_cut,
          'held_in_group_pool', v_held_in_group_pool
        )
    where id = p_market_id
    returning * into v_market;
    perform _emit_notification_event('market_resolved', v_market.group_id, v_market.id, null, v_actor_id);
    perform _bump_titles_counter(v_market.group_id);
    return v_market;
  end if;

  for rec in
    with winners as (
      select b.id, b.user_id, b.amount, b.created_at,
             floor(b.amount::numeric * (v_total_pool + v_market.bonus_pool) / v_winning_pool)::bigint as base_payout
      from bets b
      where b.market_id = p_market_id and b.settled_at is null
        and (b.side = v_winning_bet_side or b.option_id = v_outcome_option_id)
    ),
    dust as (
      select (v_total_pool + v_market.bonus_pool) - coalesce(sum(base_payout), 0) as amount from winners
    ),
    ranked as (
      select w.*, row_number() over (order by w.amount desc, w.created_at asc, w.id asc) as rn
      from winners w
    ),
    computed as (
      select r.id, r.user_id, r.base_payout + (case when r.rn = 1 then d.amount else 0 end) as payout
      from ranked r cross join dust d
    )
    update bets b
    set payout = c.payout, settled_at = now()
    from computed c
    where b.id = c.id
    returning b.id, b.user_id, b.payout
  loop
    update memberships
    set balance = balance + rec.payout
    where group_id = v_market.group_id and user_id = rec.user_id;

    insert into ledger (membership_id, amount, reason, market_id, bet_id)
    select id, rec.payout, 'payout', p_market_id, rec.id
    from memberships
    where group_id = v_market.group_id and user_id = rec.user_id;
  end loop;

  update bets set payout = 0, settled_at = now()
  where market_id = p_market_id and settled_at is null;

  update markets
  set status = 'resolved', outcome = v_outcome, outcome_option_id = v_outcome_option_id, actual_value = v_actual_value, resolved_at = now(), bonus_pool = 0
  where id = p_market_id
  returning * into v_market;

  perform _emit_notification_event('market_resolved', v_market.group_id, v_market.id, null, v_actor_id);
  perform _bump_titles_counter(v_market.group_id);

  select b.id, b.user_id into v_best_bet_id, v_best_bet_user_id
  from bets b
  join markets mk on mk.id = b.market_id
  where mk.group_id = v_market.group_id
    and b.settled_at is not null
    and b.payout > b.amount
  order by (b.payout::numeric / b.amount) desc, b.settled_at desc
  limit 1;

  perform _upsert_risk_taker(v_market.group_id);

  if v_best_bet_id is not null and exists (select 1 from bets where id = v_best_bet_id and market_id = p_market_id) then
    perform _emit_notification_event('impressive_bet', v_market.group_id, p_market_id, null, v_best_bet_user_id);
  end if;

  return v_market;
end;
$$;

revoke execute on function _finalize_market_core(uuid) from public;
revoke execute on function _finalize_market_core(uuid) from authenticated;
