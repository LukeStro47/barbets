-- Shrinks the 8 fixed titles down to 4 (Oracle, Ice Cold, Degenerate, Risk
-- Taker). Bandwagon/Cursed/On Fire/Whale are removed entirely rather than
-- kept as an uncustomizable oddity: Cursed/On Fire (streaks) and Bandwagon
-- (matches the market favorite) use bespoke window-function SQL that can't
-- be expressed by the custom-award engine's generic "rank by aggregate"
-- pattern, so keeping them meant 4 of 8 titles could never be renamed or
-- re-iconed like the rest. Whale's dynamic ("most tokens wagered") already
-- exists as the tokens_wagered_desc custom-award shape, so a group that
-- wants it back can just add it themselves.
delete from group_titles where title_key in ('bandwagon', 'cursed', 'on_fire', 'whale');

alter table group_titles drop constraint group_titles_title_key_check;
alter table group_titles add constraint group_titles_title_key_check check (
  title_key in ('oracle', 'ice_cold', 'degenerate', 'risk_taker')
);

-- Null means "use the code default" (TITLE_META's label / defaultIconKey in
-- lib/titles.ts) — same override-or-fall-back convention custom_group_titles
-- already uses for icon_key, extended here to the fixed 4 so they can be
-- renamed/re-iconed the same way a custom award can.
alter table group_titles add column label text;
alter table group_titles add column icon_key text;
alter table group_titles add constraint group_titles_label_check check (label is null or length(label) <= 30);
alter table group_titles add constraint group_titles_icon_key_check check (icon_key is null or icon_key ~ '^[a-z0-9-]{1,32}$');

-- _recompute_group_titles: same signature, body only drops the Bandwagon/
-- Cursed/On Fire/Whale blocks — Oracle/Ice Cold/Degenerate are unchanged.
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

-- rename_group_title: owner-only, same auth/validation shape as
-- create_custom_group_title. A blank label or icon_key resets that field
-- back to the code default (TITLE_META's label / defaultIconKey) rather than
-- storing an empty string.
create function rename_group_title(
  p_group_id uuid,
  p_title_key text,
  p_label text,
  p_icon_key text
) returns group_titles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_group groups%rowtype;
  v_label text;
  v_icon_key text;
  v_row group_titles%rowtype;
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
    raise exception 'forbidden: only the group owner can rename an award';
  end if;

  if p_title_key not in ('oracle', 'ice_cold', 'degenerate', 'risk_taker') then
    raise exception 'not_found: award not found';
  end if;

  v_label := nullif(trim(p_label), '');
  if v_label is not null and length(v_label) > 30 then
    raise exception 'invalid_operation: award name must be 30 characters or fewer';
  end if;

  v_icon_key := nullif(trim(coalesce(p_icon_key, '')), '');
  if v_icon_key is not null and v_icon_key !~ '^[a-z0-9-]{1,32}$' then
    raise exception 'invalid_operation: that is not a valid symbol';
  end if;

  update group_titles
  set label = v_label, icon_key = v_icon_key
  where group_id = p_group_id and title_key = p_title_key
  returning * into v_row;

  if v_row.group_id is null then
    raise exception 'not_found: award not found';
  end if;

  return v_row;
end;
$$;

revoke execute on function rename_group_title(uuid, text, text, text) from public;
grant execute on function rename_group_title(uuid, text, text, text) to authenticated;

-- create_custom_group_title: reject shapes that duplicate a default title's
-- dynamic. Without this an owner could create a "Highest win rate" custom
-- award that's a literal duplicate of Oracle sitting right above it on the
-- same page.
create or replace function create_custom_group_title(
  p_group_id uuid,
  p_label text,
  p_icon_key text,
  p_metric custom_title_metric,
  p_direction text
) returns custom_group_titles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_group groups%rowtype;
  v_label text;
  v_icon_key text;
  v_count int;
  v_title custom_group_titles%rowtype;
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
    raise exception 'forbidden: only the group owner can create an award';
  end if;

  if p_direction not in ('asc', 'desc') then
    raise exception 'invalid_operation: direction must be asc or desc';
  end if;

  if (p_metric = 'win_rate' and p_direction in ('asc', 'desc'))
    or (p_metric = 'bet_count' and p_direction = 'desc')
    or (p_metric = 'payout_multiple' and p_direction = 'desc')
  then
    raise exception 'invalid_operation: that award already exists as a built-in award';
  end if;

  v_label := nullif(trim(p_label), '');
  if v_label is null then
    raise exception 'invalid_operation: award name can''t be blank';
  end if;
  if length(v_label) > 30 then
    raise exception 'invalid_operation: award name must be 30 characters or fewer';
  end if;

  v_icon_key := nullif(trim(coalesce(p_icon_key, '')), '');
  if v_icon_key is null then
    raise exception 'invalid_operation: pick a symbol for the award';
  end if;
  if v_icon_key !~ '^[a-z0-9-]{1,32}$' then
    raise exception 'invalid_operation: that is not a valid symbol';
  end if;

  select count(*) into v_count from custom_group_titles where group_id = p_group_id;
  if v_count >= 5 then
    raise exception 'invalid_operation: a group can have at most 5 custom awards';
  end if;

  insert into custom_group_titles (group_id, label, icon_key, metric, direction, created_by)
  values (p_group_id, v_label, v_icon_key, p_metric, p_direction, v_caller)
  returning * into v_title;

  insert into custom_group_title_holders (custom_title_id) values (v_title.id);

  perform _compute_custom_title(v_title.id);

  return v_title;
end;
$$;

revoke execute on function create_custom_group_title(uuid, text, text, custom_title_metric, text) from public;
grant execute on function create_custom_group_title(uuid, text, text, custom_title_metric, text) to authenticated;

-- Safe no-op today (this feature is unreleased, on feat/custom-awards) —
-- defensive cleanup in case any group already created one of the now-banned
-- duplicate shapes before this guard existed.
delete from custom_group_titles where
  (metric = 'win_rate' and direction in ('asc', 'desc'))
  or (metric = 'bet_count' and direction = 'desc')
  or (metric = 'payout_multiple' and direction = 'desc');
