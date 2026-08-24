-- group_settings.awards_enabled = false (every public group) means no built-in titles, no custom
-- awards. _recompute_group_titles is the batched-comparative-titles path (Oracle/Ice Cold/
-- Degenerate); _upsert_risk_taker is the separate live-updating one finalize_market() also calls
-- on every resolution. Both early-return with no writes when the flag is off, so a public group's
-- group_titles table simply never populates rather than the Awards page just choosing not to
-- render what's sitting there. Same 2-arg / 1-arg signatures as
-- 20260824100000_shrink_default_awards.sql and 20260715120000_group_titles_functions.sql — a plain
-- CREATE OR REPLACE.
create or replace function _recompute_group_titles(p_group_id uuid, p_notify boolean default true)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_awards_enabled boolean;
  v_changed boolean := false;
  v_old_holder uuid;
  v_new_holder uuid;
  v_new_value double precision;
begin
  select awards_enabled into v_awards_enabled from group_settings where group_id = p_group_id;
  if not coalesce(v_awards_enabled, true) then
    return;
  end if;

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

  if v_changed and p_notify then
    perform _emit_notification_event('group_titles_updated', p_group_id);
  end if;
end;
$$;

revoke execute on function _recompute_group_titles(uuid, boolean) from public;

-- Risk Taker is the one title that updates live outside the batched function above (see
-- 20260715120000_group_titles_functions.sql) — gated the same way for the same reason, so a
-- public group's group_titles table never gets a live write either.
create or replace function _upsert_risk_taker(p_group_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_awards_enabled boolean;
  v_new_holder uuid;
  v_new_value double precision;
begin
  select awards_enabled into v_awards_enabled from group_settings where group_id = p_group_id;
  if not coalesce(v_awards_enabled, true) then
    return;
  end if;

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
