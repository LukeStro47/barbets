-- Multiple choice markets, function half. Every signature change here is
-- purely additive (a new trailing parameter with a default) so CREATE OR
-- REPLACE keeps replacing the existing function in place — no DROP FUNCTION
-- dance and no PostgREST overload ambiguity, unlike the bet_side->
-- market_outcome widening of cast_vote() a few migrations back, which had to
-- change an existing parameter's *type* and so needed a real drop.

-- create_market: branches on market_type. yes_no/over_under keep the exact
-- validation they had (market-level p_subject_user_ids). multiple_choice
-- takes p_options (2-10 labels) and p_option_subjects (a jsonb array,
-- index-aligned with p_options, where each element is a jsonb array of
-- subject user_id strings for that option) instead. The subject-count cap
-- and "creator can't be a subject" both apply to the UNION of distinct users
-- across every option, per the spec: being @'d in any option hides the
-- whole market, so the roles that must stay unoccupied (creator, and later a
-- separate endorser) are unoccupied market-wide, not per-option.
create or replace function create_market(
  p_group_id uuid,
  p_title text,
  p_description text,
  p_market_type market_type,
  p_closes_at timestamptz,
  p_line numeric default null,
  p_subject_user_ids uuid[] default '{}',
  p_options text[] default null,
  p_option_subjects jsonb default '[]'::jsonb
) returns markets
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_settings group_settings%rowtype;
  v_season_id uuid;
  v_member_count int;
  v_subject_ids uuid[];
  v_invalid_subject_count int;
  v_market markets%rowtype;
  v_option_count int;
  v_option_id uuid;
  v_opt_subjects uuid[];
  v_all_subject_ids uuid[];
  v_all_subject_total int;
  v_idx int;
begin
  perform 1 from memberships where group_id = p_group_id and user_id = v_user_id and status <> 'removed';
  if not found then
    raise exception 'not_found: not a member of this group';
  end if;

  if p_closes_at <= now() then
    raise exception 'invalid_operation: closes_at must be in the future';
  end if;

  select * into v_settings from group_settings where group_id = p_group_id;
  if v_settings.seasons_enabled then
    select id into v_season_id from seasons where group_id = p_group_id and status = 'active';
    if v_season_id is null then
      raise exception 'invalid_operation: the group is between seasons — wait for the new season to start';
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

    -- Validate the union of subjects across all options up front, before
    -- inserting anything: total (non-distinct) count vs distinct count
    -- catches the same user @'d under two different options, which this
    -- schema's single market_subjects row per (market_id, user_id) can't
    -- represent anyway.
    v_all_subject_ids := '{}';
    v_all_subject_total := 0;
    for v_idx in 1 .. v_option_count loop
      if p_option_subjects is not null and jsonb_array_length(p_option_subjects) >= v_idx then
        select array_agg(x::uuid) into v_opt_subjects
        from jsonb_array_elements_text(p_option_subjects -> (v_idx - 1)) as x;
      else
        v_opt_subjects := null;
      end if;

      if v_opt_subjects is not null then
        v_all_subject_total := v_all_subject_total + array_length(v_opt_subjects, 1);
        v_all_subject_ids := v_all_subject_ids || v_opt_subjects;
      end if;
    end loop;

    select array_agg(distinct x) into v_all_subject_ids from unnest(v_all_subject_ids) as x;

    if v_all_subject_ids is not null then
      if v_all_subject_total <> array_length(v_all_subject_ids, 1) then
        raise exception 'invalid_operation: a member can only be a subject of one option';
      end if;

      if v_user_id = any(v_all_subject_ids) then
        raise exception 'invalid_operation: the creator cannot be a subject of their own market';
      end if;

      if array_length(v_all_subject_ids, 1) >= v_member_count - 2 then
        raise exception 'invalid_operation: this group has % members, so a market can have at most % subject(s) — enough people need to be left to create, endorse, and bet on it', v_member_count, greatest(v_member_count - 2, 0);
      end if;

      select count(*) into v_invalid_subject_count
      from unnest(v_all_subject_ids) as x
      where not exists (
        select 1 from memberships where group_id = p_group_id and user_id = x and status = 'active'
      );
      if v_invalid_subject_count > 0 then
        raise exception 'invalid_operation: all subjects must be active members of the group';
      end if;
    end if;

    insert into markets (group_id, season_id, title, description, market_type, line, creator_id, closes_at)
    values (p_group_id, v_season_id, p_title, p_description, p_market_type, null, v_user_id, p_closes_at)
    returning * into v_market;

    for v_idx in 1 .. v_option_count loop
      insert into market_options (market_id, label, sort_order)
      values (v_market.id, trim(p_options[v_idx]), v_idx)
      returning id into v_option_id;

      if p_option_subjects is not null and jsonb_array_length(p_option_subjects) >= v_idx then
        insert into market_subjects (market_id, user_id, option_id)
        select v_market.id, x::uuid, v_option_id
        from jsonb_array_elements_text(p_option_subjects -> (v_idx - 1)) as x;
      end if;
    end loop;
  else
    select array_agg(distinct x) into v_subject_ids from unnest(p_subject_user_ids) as x;

    if v_subject_ids is not null and v_user_id = any(v_subject_ids) then
      raise exception 'invalid_operation: the creator cannot be a subject of their own market';
    end if;

    if v_subject_ids is not null then
      if array_length(v_subject_ids, 1) >= v_member_count - 2 then
        raise exception 'invalid_operation: this group has % members, so a market can have at most % subject(s) — enough people need to be left to create, endorse, and bet on it', v_member_count, greatest(v_member_count - 2, 0);
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

    insert into markets (group_id, season_id, title, description, market_type, line, creator_id, closes_at)
    values (p_group_id, v_season_id, p_title, p_description, p_market_type, p_line, v_user_id, p_closes_at)
    returning * into v_market;

    if v_subject_ids is not null then
      insert into market_subjects (market_id, user_id)
      select v_market.id, x from unnest(v_subject_ids) as x;
    end if;
  end if;

  perform _emit_notification_event('market_needs_endorsement', p_group_id, v_market.id, null, v_user_id);

  return v_market;
end;
$$;

revoke execute on function create_market(uuid, text, text, market_type, timestamptz, numeric, uuid[], text[], jsonb) from public;
grant execute on function create_market(uuid, text, text, market_type, timestamptz, numeric, uuid[], text[], jsonb) to authenticated;

-- place_bet: multiple_choice bets carry p_option_id and leave p_side null;
-- every other type keeps betting via p_side and leaves p_option_id null.
-- bets_side_xor_option backstops this at the DB level regardless.
create or replace function place_bet(p_market_id uuid, p_side bet_side, p_amount int, p_option_id uuid default null)
returns bets
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_market markets%rowtype;
  v_cap_pct int;
  v_membership memberships%rowtype;
  v_max_bet int;
  v_bet bets%rowtype;
begin
  select * into v_market from markets where id = p_market_id for update;
  if v_market.id is null then
    raise exception 'not_found: market not found';
  end if;

  if exists (select 1 from market_subjects where market_id = p_market_id and user_id = v_user_id) then
    raise exception 'not_found: market not found';
  end if;

  if v_market.status <> 'open' or v_market.closes_at <= now() then
    raise exception 'invalid_operation: betting is not open on this market';
  end if;

  if v_market.market_type = 'multiple_choice' then
    if p_side is not null then
      raise exception 'invalid_operation: side does not match market type';
    end if;
    if p_option_id is null then
      raise exception 'invalid_operation: choose an option to bet on';
    end if;
    perform 1 from market_options where id = p_option_id and market_id = p_market_id;
    if not found then
      raise exception 'invalid_operation: option does not belong to this market';
    end if;
  else
    if p_option_id is not null then
      raise exception 'invalid_operation: this market does not use options';
    end if;
    if (v_market.market_type = 'yes_no' and p_side not in ('yes', 'no'))
       or (v_market.market_type = 'over_under' and p_side not in ('over', 'under')) then
      raise exception 'invalid_operation: side does not match market type';
    end if;
  end if;

  select coalesce(s.bet_cap_pct, gs.bet_cap_pct) into v_cap_pct
  from group_settings gs
  left join seasons s on s.id = v_market.season_id
  where gs.group_id = v_market.group_id;

  select * into v_membership
  from memberships
  where group_id = v_market.group_id and user_id = v_user_id
  for update;

  if v_membership.id is null or v_membership.status = 'removed' then
    raise exception 'not_found: not a member of this group';
  end if;

  if v_membership.status = 'dormant' then
    raise exception 'invalid_operation: dormant members cannot bet — opt in to the current season first';
  end if;

  if v_membership.balance < 1 then
    raise exception 'insufficient_balance: you have no tokens to bet';
  end if;

  v_max_bet := greatest(1, floor(v_membership.balance * v_cap_pct / 100.0)::int);
  if v_max_bet > v_membership.balance then
    v_max_bet := v_membership.balance;
  end if;

  if p_amount < 1 or p_amount > v_max_bet then
    raise exception 'invalid_operation: amount must be between 1 and your current cap of %', v_max_bet;
  end if;

  insert into bets (market_id, user_id, side, amount, option_id)
  values (p_market_id, v_user_id, p_side, p_amount, p_option_id)
  returning * into v_bet;

  update memberships set balance = balance - p_amount where id = v_membership.id;

  insert into ledger (membership_id, amount, reason, market_id, bet_id)
  values (v_membership.id, -p_amount, 'bet', p_market_id, v_bet.id);

  return v_bet;
end;
$$;

revoke execute on function place_bet(uuid, bet_side, int, uuid) from public;
grant execute on function place_bet(uuid, bet_side, int, uuid) to authenticated;

-- get_closed_odds: unchanged except a guard steering multiple_choice callers
-- to get_closed_odds_options instead (a bet_side-shaped result can't
-- represent an N-option market).
create or replace function get_closed_odds(p_market_id uuid)
returns table (side bet_side, pool_amount bigint, bet_count bigint, pool_percent numeric)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_market markets%rowtype;
  v_total bigint;
  v_sides bet_side[];
begin
  if not is_market_visible(p_market_id) then
    raise exception 'not_found: market not found';
  end if;

  select * into v_market from markets where id = p_market_id;

  if v_market.market_type = 'multiple_choice' then
    raise exception 'invalid_operation: use get_closed_odds_options for multiple choice markets';
  end if;

  if v_market.status in ('pending_sponsor', 'open') then
    raise exception 'invalid_operation: odds are not available until betting closes';
  end if;

  v_sides := case v_market.market_type
    when 'yes_no' then array['yes', 'no']::bet_side[]
    else array['over', 'under']::bet_side[]
  end;

  select coalesce(sum(b.amount), 0) into v_total from bets b where b.market_id = p_market_id;

  return query
  select
    s as side,
    coalesce(sum(b.amount), 0)::bigint as pool_amount,
    count(b.id) as bet_count,
    case when v_total = 0 then 0
         else round(coalesce(sum(b.amount), 0)::numeric * 100 / v_total, 1)
    end as pool_percent
  from unnest(v_sides) as s
  left join bets b on b.market_id = p_market_id and b.side = s
  group by s
  order by s;
end;
$$;

revoke execute on function get_closed_odds(uuid) from public;
grant execute on function get_closed_odds(uuid) to authenticated;

-- get_closed_odds_options: the multiple_choice equivalent of get_closed_odds
-- — one row per option (even a zero-bet option), pool share by percentage.
create or replace function get_closed_odds_options(p_market_id uuid)
returns table (option_id uuid, label text, sort_order int, pool_amount bigint, bet_count bigint, pool_percent numeric)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_market markets%rowtype;
  v_total bigint;
begin
  if not is_market_visible(p_market_id) then
    raise exception 'not_found: market not found';
  end if;

  select * into v_market from markets where id = p_market_id;

  if v_market.market_type <> 'multiple_choice' then
    raise exception 'invalid_operation: this market does not use options';
  end if;

  if v_market.status in ('pending_sponsor', 'open') then
    raise exception 'invalid_operation: odds are not available until betting closes';
  end if;

  select coalesce(sum(b.amount), 0) into v_total from bets b where b.market_id = p_market_id;

  return query
  select
    mo.id as option_id,
    mo.label,
    mo.sort_order,
    coalesce(sum(b.amount), 0)::bigint as pool_amount,
    count(b.id) as bet_count,
    case when v_total = 0 then 0
         else round(coalesce(sum(b.amount), 0)::numeric * 100 / v_total, 1)
    end as pool_percent
  from market_options mo
  left join bets b on b.option_id = mo.id
  where mo.market_id = p_market_id
  group by mo.id, mo.label, mo.sort_order
  order by mo.sort_order;
end;
$$;

revoke execute on function get_closed_odds_options(uuid) from public;
grant execute on function get_closed_odds_options(uuid) to authenticated;

-- propose_resolution: multiple_choice proposes p_option_id (a specific
-- option) XOR p_outcome = 'void'; every other type keeps proposing via
-- p_outcome exactly as before, with p_option_id left null.
create or replace function propose_resolution(
  p_market_id uuid,
  p_outcome market_outcome,
  p_justification text default null,
  p_actual_value numeric default null,
  p_option_id uuid default null
) returns resolution_proposals
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_market markets%rowtype;
  v_proposal resolution_proposals%rowtype;
  v_was_open boolean;
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
  v_was_open := (v_market.status = 'open');

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

  insert into resolution_proposals (market_id, proposer_id, proposed_outcome, justification, actual_value, proposed_option_id)
  values (p_market_id, v_user_id, p_outcome, p_justification, p_actual_value, p_option_id)
  returning * into v_proposal;

  update markets
  set status = 'proposed', closed_at = coalesce(closed_at, now())
  where id = p_market_id;

  if v_was_open then
    perform _emit_notification_event('market_closed', v_market.group_id, p_market_id, null, v_user_id);
  end if;

  perform _emit_notification_event('resolution_proposed', v_market.group_id, p_market_id, null, v_user_id);

  return v_proposal;
end;
$$;

revoke execute on function propose_resolution(uuid, market_outcome, text, numeric, uuid) from public;
grant execute on function propose_resolution(uuid, market_outcome, text, numeric, uuid) to authenticated;

-- cast_vote: multiple_choice votes carry p_option_id XOR p_outcome = 'void';
-- every other type keeps voting via p_outcome exactly as before.
create or replace function cast_vote(p_market_id uuid, p_outcome market_outcome, p_option_id uuid default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_market markets%rowtype;
  v_challenge challenges%rowtype;
  v_eligible_voters int;
  v_votes_cast int;
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

  if v_market.status <> 'disputed' then
    raise exception 'invalid_operation: market is not open for voting';
  end if;

  select * into v_challenge from challenges where market_id = p_market_id;
  if v_challenge.created_at + interval '24 hours' <= now() then
    raise exception 'invalid_operation: voting has closed';
  end if;

  if v_market.market_type = 'multiple_choice' then
    if p_option_id is not null then
      if p_outcome is not null then
        raise exception 'invalid_operation: choose an option or VOID, not both';
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

  insert into votes (market_id, voter_id, outcome, voted_option_id)
  values (p_market_id, v_user_id, p_outcome, p_option_id)
  on conflict (market_id, voter_id) do update set outcome = excluded.outcome, voted_option_id = excluded.voted_option_id, created_at = now();

  select count(*) into v_eligible_voters
  from memberships m
  where m.group_id = v_market.group_id
    and m.status <> 'removed'
    and not exists (select 1 from market_subjects ms where ms.market_id = p_market_id and ms.user_id = m.user_id);

  select count(distinct voter_id) into v_votes_cast from votes where market_id = p_market_id;

  if v_votes_cast >= v_eligible_voters then
    perform finalize_market(p_market_id);
  end if;
end;
$$;

revoke execute on function cast_vote(uuid, market_outcome, uuid) from public;
grant execute on function cast_vote(uuid, market_outcome, uuid) to authenticated;

-- finalize_market: generalizes to multiple_choice by tallying votes on a
-- unified key (a specific option, or the literal 'void'), and by unifying
-- the payout engine's winner-filter to "side = v_winning_bet_side OR
-- option_id = v_outcome_option_id" — exactly one of those two variables is
-- ever non-null for a given market, so this single filter is correct for
-- every market_type without branching the actual payout/dust math at all.
-- The turnout rule (zero turnout / a tie including the proposal upholds the
-- proposal; a tie excluding it voids) applies identically, just keyed on the
-- unified tally instead of raw vote outcomes.
create or replace function finalize_market(p_market_id uuid)
returns markets
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_id uuid := auth.uid();
  v_market markets%rowtype;
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
  rec record;
begin
  select * into v_market from markets where id = p_market_id for update;
  if v_market.id is null then
    raise exception 'not_found: market not found';
  end if;

  if v_market.status not in ('proposed', 'disputed') then
    raise exception 'invalid_operation: market is not awaiting finalization';
  end if;

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
    perform refund_all_bets(p_market_id);
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
             floor(b.amount::numeric * v_total_pool / v_winning_pool)::bigint as base_payout
      from bets b
      where b.market_id = p_market_id and b.settled_at is null
        and (b.side = v_winning_bet_side or b.option_id = v_outcome_option_id)
    ),
    dust as (
      select v_total_pool - coalesce(sum(base_payout), 0) as amount from winners
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
  set status = 'resolved', outcome = v_outcome, outcome_option_id = v_outcome_option_id, actual_value = v_actual_value, resolved_at = now()
  where id = p_market_id
  returning * into v_market;

  perform _emit_notification_event('market_resolved', v_market.group_id, v_market.id, null, v_actor_id);

  return v_market;
end;
$$;

revoke execute on function finalize_market(uuid) from public;
grant execute on function finalize_market(uuid) to authenticated;
