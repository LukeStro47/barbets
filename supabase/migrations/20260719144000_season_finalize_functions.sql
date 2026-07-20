-- Season wind-down: end_season() no longer force-voids a market that's
-- already proposed/disputed (someone started resolving it) — it lets that
-- market keep running through its normal 8h timers, capped at 8h past the
-- season's end (season_status 'winding_down', seasons.wind_down_deadline).
-- The season only fully archives (season_results snapshot + next
-- intermission row) once every in-flight market clears naturally or that
-- cap is hit. end_season() itself still handles the common case (nothing in
-- flight) synchronously, same as before.

create function _compute_season_ends_at(p_season_length season_length, p_custom_ends_at timestamptz, p_from timestamptz)
returns timestamptz
language sql
immutable
as $$
  select case p_season_length
    when '1m' then p_from + interval '1 month'
    when '2m' then p_from + interval '2 months'
    when '3m' then p_from + interval '3 months'
    when 'custom' then p_custom_ends_at
    else null -- 'manual'
  end
$$;

create or replace function end_season(p_group_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_group groups%rowtype;
  v_season seasons%rowtype;
  v_in_flight int;
  rec record;
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
    raise exception 'forbidden: only the group owner can end the season';
  end if;

  select * into v_season from seasons where group_id = p_group_id and status = 'active' for update;
  if v_season.id is null then
    raise exception 'invalid_operation: no active season to end';
  end if;

  -- Force-void everything that never even had a resolution proposed —
  -- nothing to wait on. Markets already 'proposed'/'disputed' are left
  -- alone; they get a grace window instead (below).
  for rec in
    select id from markets
    where season_id = v_season.id and status in ('pending_sponsor', 'open', 'closed')
    for update
  loop
    perform _void_market(rec.id);
  end loop;

  select count(*) into v_in_flight
  from markets
  where season_id = v_season.id and status in ('proposed', 'disputed');

  update seasons set ended_at = now() where id = v_season.id;

  if v_in_flight = 0 then
    perform _finalize_season(v_season.id);
  else
    update seasons
    set status = 'winding_down', wind_down_deadline = now() + interval '8 hours'
    where id = v_season.id;
  end if;
end;
$$;

revoke execute on function end_season(uuid) from public;
grant execute on function end_season(uuid) to authenticated;

-- _finalize_season: everything end_season() used to do right after voiding
-- — snapshot season_results, archive, open the next intermission row. Now
-- callable from three places: end_season() itself (nothing was in flight),
-- finalize_market()'s tail hook (the last in-flight market just cleared),
-- and expire_stale()'s wind-down hard-cap sweep.
create function _finalize_season(p_season_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_season seasons%rowtype;
  v_next_number int;
  v_snapshot jsonb;
begin
  select * into v_season from seasons where id = p_season_id for update;
  if v_season.id is null then
    return;
  end if;

  select jsonb_build_object(
    'champion', (
      select jsonb_build_object('user_id', m.user_id, 'nickname', m.nickname, 'balance', m.balance)
      from memberships m
      where m.group_id = v_season.group_id and m.status <> 'removed'
      order by m.balance desc, m.user_id
      limit 1
    ),
    'final_balances', (
      select coalesce(
        jsonb_agg(jsonb_build_object('user_id', m.user_id, 'nickname', m.nickname, 'balance', m.balance) order by m.balance desc),
        '[]'::jsonb
      )
      from memberships m
      where m.group_id = v_season.group_id and m.status <> 'removed'
    ),
    'biggest_single_win', (
      select jsonb_build_object('user_id', m.user_id, 'nickname', m.nickname, 'amount', l.amount, 'market_id', l.market_id)
      from ledger l
      join memberships m on m.id = l.membership_id
      where m.group_id = v_season.group_id and l.reason = 'payout' and l.created_at >= v_season.started_at
      order by l.amount desc
      limit 1
    ),
    'worst_beat', (
      select jsonb_build_object('user_id', m2.user_id, 'nickname', m2.nickname, 'amount', b.amount, 'market_id', b.market_id)
      from bets b
      join markets mk on mk.id = b.market_id
      join memberships m2 on m2.group_id = mk.group_id and m2.user_id = b.user_id
      where mk.group_id = v_season.group_id and mk.season_id = v_season.id and b.payout = 0
      order by b.amount desc
      limit 1
    )
  ) into v_snapshot;

  insert into season_results (group_id, season_id, snapshot)
  values (v_season.group_id, v_season.id, v_snapshot);

  update seasons set status = 'archived' where id = v_season.id;

  -- actor is null: this can now fire well after the owner's end_season()
  -- call (triggered by a bettor's vote clearing the last in-flight market,
  -- or by expire_stale()'s wind-down sweep), so there's no single honest
  -- actor left to exclude from the notification.
  perform _emit_notification_event('season_ended', v_season.group_id, null, v_season.id, null);

  select coalesce(max(number), 0) + 1 into v_next_number from seasons where group_id = v_season.group_id;

  insert into seasons (group_id, number, status)
  values (v_season.group_id, v_next_number, 'intermission');
end;
$$;

revoke execute on function _finalize_season(uuid) from public;
revoke execute on function _finalize_season(uuid) from authenticated;

-- _maybe_archive_winding_down_season: no-op unless the season is actually
-- winding_down; archives it the moment nothing proposed/disputed remains.
create function _maybe_archive_winding_down_season(p_season_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_remaining int;
begin
  perform 1 from seasons where id = p_season_id and status = 'winding_down';
  if not found then
    return;
  end if;

  select count(*) into v_remaining
  from markets
  where season_id = p_season_id and status in ('proposed', 'disputed');

  if v_remaining = 0 then
    perform _finalize_season(p_season_id);
  end if;
end;
$$;

revoke execute on function _maybe_archive_winding_down_season(uuid) from public;
revoke execute on function _maybe_archive_winding_down_season(uuid) from authenticated;

-- finalize_market: existing body (payout math untouched) renamed to an
-- internal core function; the public entry point becomes a thin wrapper
-- that, after finalizing, checks whether it just cleared the last in-flight
-- market of a winding-down season and archives it immediately if so —
-- rather than waiting up to a minute for the next expire_stale() tick.
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
  v_endorser_cut bigint;
  v_remainder bigint;
  v_other_markets_cut bigint;
  v_refunded_to_bettors bigint;
  v_settled_to_owner bigint;
  v_other_market_ids uuid[];
  v_n int;
  v_share bigint;
  v_dust bigint;
  v_owner_id uuid;
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
    if v_proposal.proposed_at + interval '8 hours' > now() then
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

    if v_challenge.created_at + interval '8 hours' > now() and v_votes_cast < v_eligible_voters then
      raise exception 'invalid_operation: the vote window is still open';
    end if;

    -- Unified tally key: an option's id as text, or the literal 'void'.
    -- Exactly one of outcome/voted_option_id is set per ballot (same XOR
    -- convention as everywhere else), so coalesce is safe and lossless.
    select coalesce(voted_option_id::text, outcome::text), count(*) into v_top_key, v_top_count
    from votes
    where market_id = p_market_id
    group by 1
    order by count(*) desc
    limit 1;

    v_proposed_key := coalesce(v_proposal.proposed_option_id::text, v_proposal.proposed_outcome::text);

    if v_top_count is null or v_top_count = 0 then
      -- Nobody voted: apathy upholds the proposal instead of voiding it.
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
      -- else: outright winner (possibly 'void' itself) stands as v_top_key.
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

    -- sponsor_id is always set by this point — a market can't reach
    -- 'proposed'/'disputed' without going through sponsor_market() first.
    v_real_pool := v_total_pool;
    v_creator_cut := floor(v_real_pool::numeric * v_settings.creator_payout_pct / 100)::bigint;
    v_endorser_cut := floor(v_real_pool::numeric * v_settings.endorser_payout_pct / 100)::bigint;
    v_remainder := v_real_pool + v_market.bonus_pool - v_creator_cut - v_endorser_cut;
    v_other_markets_cut := 0;
    v_refunded_to_bettors := 0;
    v_settled_to_owner := 0;

    if v_creator_cut > 0 then
      update memberships set balance = balance + v_creator_cut
      where group_id = v_market.group_id and user_id = v_market.creator_id;

      insert into ledger (membership_id, amount, reason, market_id)
      select id, v_creator_cut, 'payout', p_market_id
      from memberships where group_id = v_market.group_id and user_id = v_market.creator_id;
    end if;

    if v_endorser_cut > 0 then
      update memberships set balance = balance + v_endorser_cut
      where group_id = v_market.group_id and user_id = v_market.sponsor_id;

      insert into ledger (membership_id, amount, reason, market_id)
      select id, v_endorser_cut, 'payout', p_market_id
      from memberships where group_id = v_market.group_id and user_id = v_market.sponsor_id;
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

        update bets set payout = 0, settled_at = now() where market_id = p_market_id and settled_at is null;
      elsif v_real_pool > 0 then
        v_refunded_to_bettors := v_remainder;
        for rec in
          with losers as (
            select b.id, b.user_id, b.amount, b.created_at,
                   floor(b.amount::numeric * v_remainder / v_real_pool)::bigint as base_refund
            from bets b
            where b.market_id = p_market_id and b.settled_at is null
          ),
          dust as (
            select v_remainder - coalesce(sum(base_refund), 0) as amount from losers
          ),
          ranked as (
            select l.*, row_number() over (order by l.amount desc, l.created_at asc, l.id asc) as rn
            from losers l
          ),
          computed as (
            select r.id, r.user_id, r.base_refund + (case when r.rn = 1 then d.amount else 0 end) as refund
            from ranked r cross join dust d
          )
          update bets b
          set payout = c.refund, settled_at = now()
          from computed c
          where b.id = c.id
          returning b.id, b.user_id, b.payout
        loop
          -- Unlike the winners split above, this ratio can floor a small
          -- bettor's share to exactly 0 (v_remainder is strictly less than
          -- v_real_pool once any cut applies) — skip the balance/ledger
          -- write for those rather than inserting an amount = 0 ledger row,
          -- which the amount <> 0 check rejects. bets.payout is already 0
          -- from the UPDATE above either way.
          if rec.payout > 0 then
            update memberships set balance = balance + rec.payout
            where group_id = v_market.group_id and user_id = rec.user_id;

            insert into ledger (membership_id, amount, reason, market_id, bet_id)
            select id, rec.payout, 'refund', p_market_id, rec.id
            from memberships where group_id = v_market.group_id and user_id = rec.user_id;
          end if;
        end loop;
      else
        -- No other open market, and this market had no real bettors to
        -- refund either (the whole remainder is inherited bonus money) —
        -- settle it to the group owner rather than leaving it orphaned.
        v_settled_to_owner := v_remainder;
        select owner_id into v_owner_id from groups where id = v_market.group_id;

        update memberships set balance = balance + v_remainder
        where group_id = v_market.group_id and user_id = v_owner_id;

        insert into ledger (membership_id, amount, reason, market_id)
        select id, v_remainder, 'payout', p_market_id
        from memberships where group_id = v_market.group_id and user_id = v_owner_id;
      end if;
    end if;

    update markets
    set status = 'resolved', outcome = v_outcome, outcome_option_id = v_outcome_option_id, actual_value = v_actual_value, resolved_at = now(),
        payout_breakdown = jsonb_build_object(
          'creator_cut', v_creator_cut,
          'endorser_cut', v_endorser_cut,
          'other_markets_cut', v_other_markets_cut,
          'refunded_to_bettors', v_refunded_to_bettors,
          'settled_to_owner', v_settled_to_owner
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

  -- If this market produced the group's new all-time-best payout multiple,
  -- tell the bettor directly — actor_id here means "recipient", not
  -- "exclude" (see get_event_recipients).
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

-- finalize_market: same signature as before, still authenticated-callable.
-- Wraps the core above, then archives the market's season if that was the
-- last thing it was winding down for.
create or replace function finalize_market(p_market_id uuid)
returns markets
language plpgsql
security definer
set search_path = public
as $$
declare
  v_market markets%rowtype;
begin
  v_market := _finalize_market_core(p_market_id);

  if v_market.season_id is not null then
    perform _maybe_archive_winding_down_season(v_market.season_id);
  end if;

  return v_market;
end;
$$;

revoke execute on function finalize_market(uuid) from public;
grant execute on function finalize_market(uuid) to authenticated;
