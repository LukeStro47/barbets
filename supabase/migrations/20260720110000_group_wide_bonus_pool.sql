-- A zero-winner-pool market's bonus_pool remainder used to settle to the
-- group owner outright when there was no other open market to top up and no
-- real bettors on this market to refund either (see finalize_market()/
-- refund_all_bets() in ARCHITECTURE.md). That's now a temporary holding pool
-- instead of a payout: groups.pending_bonus_pool. The next market created in
-- the group seeds its bonus_pool from it (create_market(), and
-- markets.carried_bonus_pool records that so the UI can say so). If the
-- season ends before any market claims it, _finalize_season() splits
-- whatever's left evenly across active members instead of leaving it
-- stranded.
alter table groups add column pending_bonus_pool int not null default 0 check (pending_bonus_pool >= 0);
alter table markets add column carried_bonus_pool int not null default 0 check (carried_bonus_pool >= 0);

-- 'payout' rows can now settle the even split above, which isn't tied to any
-- single market (it fires at season-archive time, once the season that would
-- have received the money is already gone) — market_id becomes optional for
-- 'payout' too, same relaxation bet_id already got for the creator/endorser
-- cuts. 'bet'/'refund' are unchanged: both still always settle one specific
-- bet on one specific market.
alter table ledger drop constraint ledger_seed_has_no_market_or_bet;
alter table ledger add constraint ledger_seed_has_no_market_or_bet check (
  (reason = 'seed' and market_id is null and bet_id is null)
  or (reason = 'payout')
  or (reason in ('bet', 'refund') and market_id is not null and bet_id is not null)
);

-- refund_all_bets: the no-other-open-market fallback for a market's own
-- bonus_pool now holds in groups.pending_bonus_pool instead of settling to
-- the owner.
create or replace function refund_all_bets(p_market_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_market markets%rowtype;
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
      update groups set pending_bonus_pool = pending_bonus_pool + v_market.bonus_pool where id = v_market.group_id;
    end if;

    update markets set bonus_pool = 0 where id = p_market_id;
  end if;
end;
$$;

revoke execute on function refund_all_bets(uuid) from public;

-- create_market: seeds a brand-new market's bonus_pool from
-- groups.pending_bonus_pool, if anything's waiting there. carried_bonus_pool
-- records the seeded amount (immutable after creation) purely for the UI
-- note — bonus_pool itself can keep growing afterward the same way it
-- always could, from another market's own zero-winner-pool split.
create or replace function create_market(
  p_group_id uuid,
  p_title text,
  p_description text,
  p_market_type market_type,
  p_closes_at timestamptz,
  p_line numeric default null,
  p_subject_user_ids uuid[] default '{}',
  p_options text[] default null,
  p_unit text default null
) returns markets
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_settings group_settings%rowtype;
  v_season_id uuid;
  v_betting_open boolean;
  v_season_ends_at timestamptz;
  v_member_count int;
  v_subject_ids uuid[];
  v_invalid_subject_count int;
  v_market markets%rowtype;
  v_option_count int;
  v_option_id uuid;
  v_option_text text;
  v_resolved_user_id uuid;
  v_all_subject_ids uuid[];
  v_idx int;
  v_unit text;
  v_pending_bonus int;
begin
  perform 1 from memberships where group_id = p_group_id and user_id = v_user_id and status <> 'removed';
  if not found then
    raise exception 'not_found: not a member of this group';
  end if;

  perform 1 from groups where id = p_group_id and deletion_scheduled_at is not null;
  if found then
    raise exception 'invalid_operation: this group is scheduled for deletion and can''t start new markets';
  end if;

  select * into v_settings from group_settings where group_id = p_group_id;

  if p_closes_at <= now() then
    raise exception 'invalid_operation: closes_at must be in the future';
  end if;

  v_unit := nullif(trim(coalesce(p_unit, '')), '');
  if v_unit is not null then
    if p_market_type <> 'over_under' then
      raise exception 'invalid_operation: a unit only applies to over/under markets';
    end if;
    if length(v_unit) > 12 then
      raise exception 'invalid_operation: unit must be 12 characters or fewer';
    end if;
  end if;

  if v_settings.seasons_enabled then
    select id, betting_open, ends_at into v_season_id, v_betting_open, v_season_ends_at
    from seasons where group_id = p_group_id and status = 'active';
    if v_season_id is null then
      raise exception 'invalid_operation: the group is between seasons, wait for the new season to start';
    end if;
    if not v_betting_open then
      raise exception 'invalid_operation: the owner hasn''t opened betting for this season yet';
    end if;
    if v_season_ends_at is not null and p_closes_at > v_season_ends_at then
      raise exception 'invalid_operation: closes_at can''t be later than the season''s end';
    end if;
  else
    if not v_settings.betting_enabled then
      raise exception 'invalid_operation: the group owner hasn''t turned betting on yet';
    end if;
  end if;

  select count(*) into v_member_count from memberships where group_id = p_group_id and status <> 'removed';

  if p_market_type = 'multiple_choice' then
    v_option_count := coalesce(array_length(p_options, 1), 0);
    if v_option_count < 2 or v_option_count > 10 then
      raise exception 'invalid_operation: multiple choice markets need between 2 and 10 options';
    end if;

    if exists (select 1 from unnest(p_options) as o where trim(o) = '') then
      raise exception 'invalid_operation: option labels cannot be blank';
    end if;

    if (select count(distinct trim(o)) from unnest(p_options) as o) <> v_option_count then
      raise exception 'invalid_operation: option labels must be unique';
    end if;

    v_all_subject_ids := '{}';
    for v_idx in 1 .. v_option_count loop
      v_option_text := trim(p_options[v_idx]);
      if left(v_option_text, 1) = '@' then
        select m.user_id into v_resolved_user_id
        from memberships m
        where m.group_id = p_group_id and m.nickname = substring(v_option_text from 2) and m.status = 'active';
        if v_resolved_user_id is null then
          raise exception 'invalid_operation: no active member named % in this group', v_option_text;
        end if;
        v_all_subject_ids := v_all_subject_ids || v_resolved_user_id;
      end if;
    end loop;

    if array_length(v_all_subject_ids, 1) > 0 then
      if array_length(v_all_subject_ids, 1) <> (select count(distinct x) from unnest(v_all_subject_ids) as x) then
        raise exception 'invalid_operation: a member can only be a subject of one option';
      end if;

      if v_user_id = any(v_all_subject_ids) then
        raise exception 'invalid_operation: the creator cannot be a subject of their own market';
      end if;

      if array_length(v_all_subject_ids, 1) >= v_member_count - 1 then
        raise exception 'invalid_operation: this group has % members, so a market can have at most % subject(s). enough people need to be left to create, endorse, and bet on it', v_member_count, greatest(v_member_count - 2, 0);
      end if;
    end if;

    insert into markets (group_id, season_id, title, description, market_type, line, creator_id, closes_at, unit)
    values (p_group_id, v_season_id, p_title, p_description, p_market_type, null, v_user_id, p_closes_at, null)
    returning * into v_market;

    for v_idx in 1 .. v_option_count loop
      v_option_text := trim(p_options[v_idx]);

      insert into market_options (market_id, label, sort_order)
      values (v_market.id, v_option_text, v_idx)
      returning id into v_option_id;

      if left(v_option_text, 1) = '@' then
        select m.user_id into v_resolved_user_id
        from memberships m
        where m.group_id = p_group_id and m.nickname = substring(v_option_text from 2) and m.status = 'active';

        insert into market_subjects (market_id, user_id, option_id)
        values (v_market.id, v_resolved_user_id, v_option_id);
      end if;
    end loop;
  else
    select array_agg(distinct x) into v_subject_ids from unnest(p_subject_user_ids) as x;

    if v_subject_ids is not null and v_user_id = any(v_subject_ids) then
      raise exception 'invalid_operation: the creator cannot be a subject of their own market';
    end if;

    if v_subject_ids is not null then
      if array_length(v_subject_ids, 1) >= v_member_count - 1 then
        raise exception 'invalid_operation: this group has % members, so a market can have at most % subject(s). enough people need to be left to create, endorse, and bet on it', v_member_count, greatest(v_member_count - 2, 0);
      end if;

      select count(*) into v_invalid_subject_count
      from unnest(v_subject_ids) as x
      where not exists (
        select 1 from memberships where group_id = p_group_id and user_id = x and status = 'active'
      );
      if v_invalid_subject_count > 0 then
        raise exception 'invalid_operation: all subjects must be active members of the group';
      end if;
    end if;

    insert into markets (group_id, season_id, title, description, market_type, line, creator_id, closes_at, unit)
    values (p_group_id, v_season_id, p_title, p_description, p_market_type, p_line, v_user_id, p_closes_at, v_unit)
    returning * into v_market;

    if v_subject_ids is not null then
      insert into market_subjects (market_id, user_id)
      select v_market.id, x from unnest(v_subject_ids) as x;
    end if;
  end if;

  select pending_bonus_pool into v_pending_bonus from groups where id = p_group_id for update;
  if v_pending_bonus > 0 then
    update markets set bonus_pool = v_pending_bonus, carried_bonus_pool = v_pending_bonus where id = v_market.id
    returning * into v_market;
    update groups set pending_bonus_pool = 0 where id = p_group_id;
  end if;

  perform _emit_notification_event('market_needs_endorsement', p_group_id, v_market.id, null, v_user_id);

  return v_market;
end;
$$;

revoke execute on function create_market(uuid, text, text, market_type, timestamptz, numeric, uuid[], text[], text) from public;
grant execute on function create_market(uuid, text, text, market_type, timestamptz, numeric, uuid[], text[], text) to authenticated;

-- _finalize_market_core: the same no-other-open-market/no-real-bettors
-- fallback as refund_all_bets() above, now holding in
-- groups.pending_bonus_pool instead of settling to the owner.
-- payout_breakdown's 'settled_to_owner' key is renamed 'held_in_group_pool'
-- to match (still exactly one of the last three ever non-zero).
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
    v_endorser_cut := floor(v_real_pool::numeric * v_settings.endorser_payout_pct / 100)::bigint;
    v_remainder := v_real_pool + v_market.bonus_pool - v_creator_cut - v_endorser_cut;
    v_other_markets_cut := 0;
    v_refunded_to_bettors := 0;
    v_held_in_group_pool := 0;

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
        -- hold it in the group's pending pool instead of settling it to the
        -- owner. create_market() seeds the next market's bonus_pool from
        -- this the moment one gets created; _finalize_season() splits
        -- whatever's still sitting there evenly across active members if
        -- the season ends first.
        v_held_in_group_pool := v_remainder;
        update groups set pending_bonus_pool = pending_bonus_pool + v_remainder where id = v_market.group_id;
      end if;
    end if;

    update markets
    set status = 'resolved', outcome = v_outcome, outcome_option_id = v_outcome_option_id, actual_value = v_actual_value, resolved_at = now(),
        payout_breakdown = jsonb_build_object(
          'creator_cut', v_creator_cut,
          'endorser_cut', v_endorser_cut,
          'other_markets_cut', v_other_markets_cut,
          'refunded_to_bettors', v_refunded_to_bettors,
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

-- _finalize_season: splits any leftover groups.pending_bonus_pool evenly
-- across active members the moment a season archives, so money nothing
-- claimed doesn't just sit there indefinitely once the season it belonged to
-- is gone. Dust (an uneven split) goes to whoever's currently in the lead,
-- same tie-break convention as the champion snapshot above. A no-op if the
-- pool is empty, or if there's nobody currently active to give it to (it
-- just stays put for a future season/market).
create or replace function _finalize_season(p_season_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_season seasons%rowtype;
  v_next_number int;
  v_snapshot jsonb;
  v_pending_bonus int;
  v_active_count int;
  v_share int;
  v_dust int;
  rec record;
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

  perform _emit_notification_event('season_ended', v_season.group_id, null, v_season.id, null);

  select pending_bonus_pool into v_pending_bonus from groups where id = v_season.group_id for update;
  if v_pending_bonus > 0 then
    select count(*) into v_active_count from memberships where group_id = v_season.group_id and status = 'active';

    if v_active_count > 0 then
      v_share := floor(v_pending_bonus::numeric / v_active_count)::int;
      v_dust := v_pending_bonus - v_share * v_active_count;

      for rec in
        with ranked as (
          select id, row_number() over (order by balance desc, user_id) as rn
          from memberships
          where group_id = v_season.group_id and status = 'active'
        )
        select id, v_share + (case when rn = 1 then v_dust else 0 end) as amount
        from ranked
      loop
        if rec.amount > 0 then
          update memberships set balance = balance + rec.amount where id = rec.id;
          insert into ledger (membership_id, amount, reason) values (rec.id, rec.amount, 'payout');
        end if;
      end loop;

      update groups set pending_bonus_pool = 0 where id = v_season.group_id;
    end if;
  end if;

  select coalesce(max(number), 0) + 1 into v_next_number from seasons where group_id = v_season.group_id;

  insert into seasons (group_id, number, status)
  values (v_season.group_id, v_next_number, 'intermission');
end;
$$;

revoke execute on function _finalize_season(uuid) from public;
revoke execute on function _finalize_season(uuid) from authenticated;
