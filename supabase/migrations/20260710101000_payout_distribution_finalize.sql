-- 'payout' ledger rows can now settle a market-level reward that isn't tied
-- to any single bet (creator/endorser cuts, and the group-owner fallback
-- when redistributed money has nowhere left to go) — bet_id becomes
-- optional for 'payout' specifically. 'bet' and 'refund' are unchanged:
-- both still always settle one specific bet.
alter table ledger drop constraint ledger_seed_has_no_market_or_bet;
alter table ledger add constraint ledger_seed_has_no_market_or_bet check (
  (reason = 'seed' and market_id is null and bet_id is null)
  or (reason = 'payout' and market_id is not null)
  or (reason in ('bet', 'refund') and market_id is not null and bet_id is not null)
);

-- refund_all_bets: unchanged for real bettor stakes. New: a market can now
-- carry bonus_pool money it received from another market's zero-winner-pool
-- split (see finalize_market() below) — that money isn't any bettor's
-- stake, so a plain refund doesn't return it to anyone. It moves on the
-- same way it arrived: split equally across whatever markets are open in
-- the group right now, or — if none are — settles to the group owner
-- rather than being silently lost.
create or replace function refund_all_bets(p_market_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_market markets%rowtype;
  v_owner_id uuid;
  v_other_market_ids uuid[];
  v_n int;
  v_share int;
  v_dust int;
  rec record;
begin
  select * into v_market from markets where id = p_market_id;

  for rec in
    update bets
    set payout = amount, settled_at = now()
    where market_id = p_market_id and settled_at is null
    returning id, user_id, amount
  loop
    update memberships
    set balance = balance + rec.amount
    where group_id = v_market.group_id and user_id = rec.user_id;

    insert into ledger (membership_id, amount, reason, market_id, bet_id)
    select id, rec.amount, 'refund', p_market_id, rec.id
    from memberships
    where group_id = v_market.group_id and user_id = rec.user_id;
  end loop;

  if v_market.bonus_pool > 0 then
    select array_agg(id order by created_at asc, id asc) into v_other_market_ids
    from markets where group_id = v_market.group_id and status = 'open';

    if v_other_market_ids is not null and array_length(v_other_market_ids, 1) > 0 then
      v_n := array_length(v_other_market_ids, 1);
      v_share := floor(v_market.bonus_pool::numeric / v_n)::int;
      v_dust := v_market.bonus_pool - v_share * v_n;

      update markets
      set bonus_pool = bonus_pool + v_share + (case when id = v_other_market_ids[1] then v_dust else 0 end)
      where id = any(v_other_market_ids);
    else
      select owner_id into v_owner_id from groups where id = v_market.group_id;

      update memberships set balance = balance + v_market.bonus_pool
      where group_id = v_market.group_id and user_id = v_owner_id;

      insert into ledger (membership_id, amount, reason, market_id)
      select id, v_market.bonus_pool, 'payout', p_market_id
      from memberships where group_id = v_market.group_id and user_id = v_owner_id;
    end if;

    update markets set bonus_pool = 0 where id = p_market_id;
  end if;
end;
$$;

revoke execute on function refund_all_bets(uuid) from public;

-- finalize_market: only the winning_pool = 0 branch changes (nobody bet on
-- the outcome that actually happened). Previously this always fell back to
-- refund_all_bets(). Now, if the group owner has turned distribute_payout
-- on, this pool instead rewards whoever created and endorsed the market
-- (creator_payout_pct / endorser_payout_pct of the real stakes on this
-- market — any bonus_pool this market already carries in isn't taxed again,
-- it just rides along with the remainder), and the remainder tops up every
-- other currently-open market's pot equally. If there's no other open
-- market to receive it, the remainder instead refunds proportionally back
-- to this market's own bettors (same floor+dust construction as a normal
-- winners split); if this market never had any real bettors either, it
-- settles to the group owner rather than being orphaned.
create or replace function finalize_market(p_market_id uuid)
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
    if v_proposal.proposed_at + interval '24 hours' > now() then
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

    if v_challenge.created_at + interval '24 hours' > now() and v_votes_cast < v_eligible_voters then
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
      return v_market;
    end if;

    -- sponsor_id is always set by this point — a market can't reach
    -- 'proposed'/'disputed' without going through sponsor_market() first.
    v_real_pool := v_total_pool;
    v_creator_cut := floor(v_real_pool::numeric * v_settings.creator_payout_pct / 100)::bigint;
    v_endorser_cut := floor(v_real_pool::numeric * v_settings.endorser_payout_pct / 100)::bigint;
    v_remainder := v_real_pool + v_market.bonus_pool - v_creator_cut - v_endorser_cut;

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
        v_n := array_length(v_other_market_ids, 1);
        v_share := floor(v_remainder::numeric / v_n)::bigint;
        v_dust := v_remainder - v_share * v_n;

        update markets
        set bonus_pool = bonus_pool + v_share + (case when id = v_other_market_ids[1] then v_dust else 0 end)
        where id = any(v_other_market_ids);

        update bets set payout = 0, settled_at = now() where market_id = p_market_id and settled_at is null;
      elsif v_real_pool > 0 then
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
        select owner_id into v_owner_id from groups where id = v_market.group_id;

        update memberships set balance = balance + v_remainder
        where group_id = v_market.group_id and user_id = v_owner_id;

        insert into ledger (membership_id, amount, reason, market_id)
        select id, v_remainder, 'payout', p_market_id
        from memberships where group_id = v_market.group_id and user_id = v_owner_id;
      end if;
    end if;

    update markets
    set status = 'resolved', outcome = v_outcome, outcome_option_id = v_outcome_option_id, actual_value = v_actual_value, resolved_at = now()
    where id = p_market_id
    returning * into v_market;
    perform _emit_notification_event('market_resolved', v_market.group_id, v_market.id, null, v_actor_id);
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

  if v_best_bet_id is not null and exists (select 1 from bets where id = v_best_bet_id and market_id = p_market_id) then
    perform _emit_notification_event('impressive_bet', v_market.group_id, p_market_id, null, v_best_bet_user_id);
  end if;

  return v_market;
end;
$$;

revoke execute on function finalize_market(uuid) from public;
grant execute on function finalize_market(uuid) to authenticated;
