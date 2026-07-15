-- group_titles_updated needs to be allowed with no market_id, same as the
-- other group-scoped event types.
alter table notification_events drop constraint notification_events_market_events_have_market;
alter table notification_events add constraint notification_events_market_events_have_market check (
  (event_type in (
    'season_ended', 'betting_opened', 'member_joined',
    'group_deletion_scheduled', 'group_deletion_canceled', 'group_titles_updated'
  ))
  or (market_id is not null)
);

-- _upsert_risk_taker: the "Risk Taker" title (formerly the standalone "most
-- impressive bet" leaderboard card) is the one title that updates live, not
-- on the 3-market cadence below. It's monotonic — a new holder only ever
-- appears by setting a genuine new all-time-best payout multiple, which is
-- already rare on its own, so there's no flapping to guard against the way
-- there is for the comparative stats. Its own push (the existing
-- impressive_bet event) already tells the bettor the moment it happens;
-- this just keeps the persistent flair in sync, no separate notification.
create or replace function _upsert_risk_taker(p_group_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new_holder uuid;
  v_new_value double precision;
begin
  select b.user_id, round(b.payout::numeric / b.amount, 1)
  into v_new_holder, v_new_value
  from bets b
  join markets mk on mk.id = b.market_id
  join memberships mem on mem.group_id = mk.group_id and mem.user_id = b.user_id and mem.status <> 'removed'
  where mk.group_id = p_group_id
    and b.settled_at is not null
    and b.payout > b.amount
  order by (b.payout::numeric / b.amount) desc, b.settled_at desc
  limit 1;

  insert into group_titles (group_id, title_key, user_id, stat_value, computed_at)
  values (p_group_id, 'risk_taker', v_new_holder, v_new_value, now())
  on conflict (group_id, title_key)
  do update set user_id = excluded.user_id, stat_value = excluded.stat_value, computed_at = excluded.computed_at;
end;
$$;

revoke execute on function _upsert_risk_taker(uuid) from public;

-- _recompute_group_titles: the other 7 titles, all comparative rankings
-- across the group's settled-bet history. "Real" bets throughout means bets
-- on markets with status = 'resolved' (never 'voided' — a void refunds
-- everyone and produces no win/loss signal), restricted to still-active
-- members so a removed member can't keep squatting on a title. p_notify
-- defaults to true; the one-off historical backfill at the bottom of this
-- migration passes false so bootstrapping every existing group doesn't fire
-- a notification blast on deploy.
create or replace function _recompute_group_titles(p_group_id uuid, p_notify boolean default true)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_changed boolean := false;
  v_old_holder uuid;
  v_new_holder uuid;
  v_new_value double precision;
begin
  -- The Oracle: highest win rate, min. 5 settled real bets.
  select b.user_id, avg(b.won::int)::numeric
  into v_new_holder, v_new_value
  from (
    select bt.user_id,
      case when m.market_type = 'multiple_choice' then bt.option_id = m.outcome_option_id else bt.side = m.outcome::text::bet_side end as won
    from bets bt
    join markets m on m.id = bt.market_id
    join memberships mem on mem.group_id = m.group_id and mem.user_id = bt.user_id and mem.status <> 'removed'
    where m.group_id = p_group_id and m.status = 'resolved'
  ) b
  group by b.user_id
  having count(*) >= 5
  order by avg(b.won::int) desc, count(*) desc, b.user_id
  limit 1;

  select user_id into v_old_holder from group_titles where group_id = p_group_id and title_key = 'oracle';
  insert into group_titles (group_id, title_key, user_id, stat_value, computed_at)
  values (p_group_id, 'oracle', v_new_holder, v_new_value, now())
  on conflict (group_id, title_key) do update set user_id = excluded.user_id, stat_value = excluded.stat_value, computed_at = excluded.computed_at;
  if v_new_holder is distinct from v_old_holder then v_changed := true; end if;

  -- Ice Cold: lowest win rate, same eligibility.
  select b.user_id, avg(b.won::int)::numeric
  into v_new_holder, v_new_value
  from (
    select bt.user_id,
      case when m.market_type = 'multiple_choice' then bt.option_id = m.outcome_option_id else bt.side = m.outcome::text::bet_side end as won
    from bets bt
    join markets m on m.id = bt.market_id
    join memberships mem on mem.group_id = m.group_id and mem.user_id = bt.user_id and mem.status <> 'removed'
    where m.group_id = p_group_id and m.status = 'resolved'
  ) b
  group by b.user_id
  having count(*) >= 5
  order by avg(b.won::int) asc, count(*) desc, b.user_id
  limit 1;

  select user_id into v_old_holder from group_titles where group_id = p_group_id and title_key = 'ice_cold';
  insert into group_titles (group_id, title_key, user_id, stat_value, computed_at)
  values (p_group_id, 'ice_cold', v_new_holder, v_new_value, now())
  on conflict (group_id, title_key) do update set user_id = excluded.user_id, stat_value = excluded.stat_value, computed_at = excluded.computed_at;
  if v_new_holder is distinct from v_old_holder then v_changed := true; end if;

  -- Bandwagon: highest rate of betting on whatever ended up the single
  -- biggest pool share in that market (the "favorite" in hindsight — nobody
  -- can see live odds while a market's open, so this can only ever measure
  -- retroactive conformity, not real-time chasing). Min. 5 settled real bets.
  with real_bets as (
    select bt.id as bet_id, bt.user_id, bt.market_id, coalesce(bt.option_id::text, bt.side::text) as choice_key, bt.amount
    from bets bt
    join markets m on m.id = bt.market_id
    join memberships mem on mem.group_id = m.group_id and mem.user_id = bt.user_id and mem.status <> 'removed'
    where m.group_id = p_group_id and m.status = 'resolved'
  ),
  choice_pools as (
    select market_id, choice_key, sum(amount) as pool
    from real_bets
    group by market_id, choice_key
  ),
  market_favorite as (
    select distinct on (market_id) market_id, choice_key as favorite_key
    from choice_pools
    order by market_id, pool desc, choice_key
  ),
  tagged as (
    select rb.user_id, (rb.choice_key = mf.favorite_key) as backed_favorite
    from real_bets rb
    join market_favorite mf on mf.market_id = rb.market_id
  )
  select t.user_id, avg(t.backed_favorite::int)::numeric
  into v_new_holder, v_new_value
  from tagged t
  group by t.user_id
  having count(*) >= 5
  order by avg(t.backed_favorite::int) desc, count(*) desc, t.user_id
  limit 1;

  select user_id into v_old_holder from group_titles where group_id = p_group_id and title_key = 'bandwagon';
  insert into group_titles (group_id, title_key, user_id, stat_value, computed_at)
  values (p_group_id, 'bandwagon', v_new_holder, v_new_value, now())
  on conflict (group_id, title_key) do update set user_id = excluded.user_id, stat_value = excluded.stat_value, computed_at = excluded.computed_at;
  if v_new_holder is distinct from v_old_holder then v_changed := true; end if;

  -- Cursed: longest active losing streak (min. 2 — a single loss isn't a
  -- streak). Standard gaps-and-islands: rn is chronological order per user,
  -- rn2 is chronological order within same-outcome runs, so (rn - rn2) is
  -- constant within one unbroken streak. The streak containing each user's
  -- most recent bet is their *current* one.
  with real_bets as (
    select bt.id as bet_id, bt.user_id, m.resolved_at,
      case when m.market_type = 'multiple_choice' then bt.option_id = m.outcome_option_id else bt.side = m.outcome::text::bet_side end as won
    from bets bt
    join markets m on m.id = bt.market_id
    join memberships mem on mem.group_id = m.group_id and mem.user_id = bt.user_id and mem.status <> 'removed'
    where m.group_id = p_group_id and m.status = 'resolved'
  ),
  ordered as (
    select user_id, won,
      row_number() over (partition by user_id order by resolved_at, bet_id) as rn,
      row_number() over (partition by user_id, won order by resolved_at, bet_id) as rn2
    from real_bets
  ),
  grouped as (
    select user_id, won, count(*) as streak_len, max(rn) as last_rn
    from ordered
    group by user_id, won, (rn - rn2)
  ),
  last_rn_per_user as (
    select user_id, max(rn) as max_rn from ordered group by user_id
  )
  select g.user_id, g.streak_len::numeric
  into v_new_holder, v_new_value
  from grouped g
  join last_rn_per_user l on l.user_id = g.user_id and g.last_rn = l.max_rn
  where g.won = false and g.streak_len >= 2
  order by g.streak_len desc, g.user_id
  limit 1;

  select user_id into v_old_holder from group_titles where group_id = p_group_id and title_key = 'cursed';
  insert into group_titles (group_id, title_key, user_id, stat_value, computed_at)
  values (p_group_id, 'cursed', v_new_holder, v_new_value, now())
  on conflict (group_id, title_key) do update set user_id = excluded.user_id, stat_value = excluded.stat_value, computed_at = excluded.computed_at;
  if v_new_holder is distinct from v_old_holder then v_changed := true; end if;

  -- On Fire: same mechanic, longest active winning streak.
  with real_bets as (
    select bt.id as bet_id, bt.user_id, m.resolved_at,
      case when m.market_type = 'multiple_choice' then bt.option_id = m.outcome_option_id else bt.side = m.outcome::text::bet_side end as won
    from bets bt
    join markets m on m.id = bt.market_id
    join memberships mem on mem.group_id = m.group_id and mem.user_id = bt.user_id and mem.status <> 'removed'
    where m.group_id = p_group_id and m.status = 'resolved'
  ),
  ordered as (
    select user_id, won,
      row_number() over (partition by user_id order by resolved_at, bet_id) as rn,
      row_number() over (partition by user_id, won order by resolved_at, bet_id) as rn2
    from real_bets
  ),
  grouped as (
    select user_id, won, count(*) as streak_len, max(rn) as last_rn
    from ordered
    group by user_id, won, (rn - rn2)
  ),
  last_rn_per_user as (
    select user_id, max(rn) as max_rn from ordered group by user_id
  )
  select g.user_id, g.streak_len::numeric
  into v_new_holder, v_new_value
  from grouped g
  join last_rn_per_user l on l.user_id = g.user_id and g.last_rn = l.max_rn
  where g.won = true and g.streak_len >= 2
  order by g.streak_len desc, g.user_id
  limit 1;

  select user_id into v_old_holder from group_titles where group_id = p_group_id and title_key = 'on_fire';
  insert into group_titles (group_id, title_key, user_id, stat_value, computed_at)
  values (p_group_id, 'on_fire', v_new_holder, v_new_value, now())
  on conflict (group_id, title_key) do update set user_id = excluded.user_id, stat_value = excluded.stat_value, computed_at = excluded.computed_at;
  if v_new_holder is distinct from v_old_holder then v_changed := true; end if;

  -- Degenerate: most bets ever placed (any status, not just resolved).
  select bt.user_id, count(*)::numeric
  into v_new_holder, v_new_value
  from bets bt
  join markets m on m.id = bt.market_id
  join memberships mem on mem.group_id = m.group_id and mem.user_id = bt.user_id and mem.status <> 'removed'
  where m.group_id = p_group_id
  group by bt.user_id
  order by count(*) desc, bt.user_id
  limit 1;

  select user_id into v_old_holder from group_titles where group_id = p_group_id and title_key = 'degenerate';
  insert into group_titles (group_id, title_key, user_id, stat_value, computed_at)
  values (p_group_id, 'degenerate', v_new_holder, v_new_value, now())
  on conflict (group_id, title_key) do update set user_id = excluded.user_id, stat_value = excluded.stat_value, computed_at = excluded.computed_at;
  if v_new_holder is distinct from v_old_holder then v_changed := true; end if;

  -- Whale: largest total amount ever wagered (any status).
  select bt.user_id, sum(bt.amount)::numeric
  into v_new_holder, v_new_value
  from bets bt
  join markets m on m.id = bt.market_id
  join memberships mem on mem.group_id = m.group_id and mem.user_id = bt.user_id and mem.status <> 'removed'
  where m.group_id = p_group_id
  group by bt.user_id
  order by sum(bt.amount) desc, bt.user_id
  limit 1;

  select user_id into v_old_holder from group_titles where group_id = p_group_id and title_key = 'whale';
  insert into group_titles (group_id, title_key, user_id, stat_value, computed_at)
  values (p_group_id, 'whale', v_new_holder, v_new_value, now())
  on conflict (group_id, title_key) do update set user_id = excluded.user_id, stat_value = excluded.stat_value, computed_at = excluded.computed_at;
  if v_new_holder is distinct from v_old_holder then v_changed := true; end if;

  if v_changed and p_notify then
    perform _emit_notification_event('group_titles_updated', p_group_id);
  end if;
end;
$$;

revoke execute on function _recompute_group_titles(uuid, boolean) from public;

-- _bump_titles_counter: called once per market that reaches 'resolved'
-- (never 'voided'). Every 3rd call resets the counter and triggers a
-- recompute of the 7 batched titles above.
create or replace function _bump_titles_counter(p_group_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  update group_settings
  set markets_resolved_since_titles = markets_resolved_since_titles + 1
  where group_id = p_group_id
  returning markets_resolved_since_titles into v_count;

  if v_count >= 3 then
    update group_settings set markets_resolved_since_titles = 0 where group_id = p_group_id;
    perform _recompute_group_titles(p_group_id);
  end if;
end;
$$;

revoke execute on function _bump_titles_counter(uuid) from public;

-- get_event_recipients: group_titles_updated is group-scoped like
-- season_ended/betting_opened — everyone's titles just potentially shuffled,
-- not just one person's.
create or replace function get_event_recipients(p_event_id uuid)
returns table (user_id uuid)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_event notification_events%rowtype;
begin
  select * into v_event from notification_events where id = p_event_id;
  if v_event.id is null then
    return;
  end if;

  if v_event.event_type = 'member_joined' then
    return query
    select g.owner_id as user_id
    from groups g
    join push_subscriptions ps on ps.user_id = g.owner_id
    join users u on u.id = g.owner_id and u.notifications_enabled = true
    where g.id = v_event.group_id
      and (v_event.actor_id is null or g.owner_id <> v_event.actor_id)
    group by g.owner_id;
  elsif v_event.event_type = 'impressive_bet' then
    return query
    select u.id as user_id
    from users u
    join push_subscriptions ps on ps.user_id = u.id
    where u.id = v_event.actor_id and u.notifications_enabled = true
    group by u.id;
  elsif v_event.event_type in (
    'season_ended', 'betting_opened', 'group_deletion_scheduled', 'group_deletion_canceled', 'group_titles_updated'
  ) then
    return query
    select m.user_id
    from memberships m
    join push_subscriptions ps on ps.user_id = m.user_id
    join users u on u.id = m.user_id and u.notifications_enabled = true
    where m.group_id = v_event.group_id
      and m.status <> 'removed'
      and (v_event.actor_id is null or m.user_id <> v_event.actor_id)
    group by m.user_id;
  else
    return query
    select gnr.user_id
    from get_notification_recipients(v_event.market_id, v_event.event_type in ('market_resolved', 'market_voided')) gnr
    where v_event.actor_id is null or gnr.user_id <> v_event.actor_id;
  end if;
end;
$$;

-- finalize_market: adds a titles-counter bump at every point a market
-- actually reaches 'resolved' (not 'voided' — a void has no win/loss
-- signal), plus a live risk_taker refresh alongside the existing
-- impressive_bet check, which already computes exactly the data it needs.
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

revoke execute on function finalize_market(uuid) from public;
grant execute on function finalize_market(uuid) to authenticated;

-- One-time backfill so every existing group gets titles immediately instead
-- of waiting on 3 fresh resolutions — p_notify := false so this doesn't
-- fire a notification blast to every group the moment this migration lands.
do $$
declare
  rec record;
begin
  for rec in select id from groups loop
    perform _recompute_group_titles(rec.id, false);
    perform _upsert_risk_taker(rec.id);
  end loop;
end;
$$;
