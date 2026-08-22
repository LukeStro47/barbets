-- Custom awards: the group owner can configure a new auto-computed award
-- from a fixed menu of 15 "shapes," rather than being limited to the 8
-- fixed titles in lib/titles.ts. This is what the awards page's old
-- "Propose an award / Soon" placeholder (removed for costing attention on
-- every visit to advertise a feature that didn't exist) finally becomes.
--
-- Deliberately a *separate* table from group_titles, not a generalization of
-- it: group_titles' 8 keys are a closed, code-defined enum (lib/titles.ts's
-- TITLE_ORDER), and its computation logic (streaks, "matches the favorite")
-- includes shapes that don't generalize into a parameterized menu at all
-- (see the notable-decisions note on why streak/Bandwagon-style metrics are
-- excluded from this menu entirely). Custom titles are group-scoped data,
-- not app-defined code, so their label/emoji/description live in this table
-- rather than in TypeScript.
--
-- Only 5 of the 15-shape menu's "families" are genuinely new query shapes;
-- the rest are the same "rank everyone by an aggregate, take #1" pattern
-- _recompute_group_titles already uses for Oracle/Ice Cold/Degenerate/Whale,
-- just reaching a different table. Deliberately excluded from the menu:
-- streak-based and "matches the market favorite" shapes, which need bespoke
-- window-function SQL that doesn't parameterize cleanly (same reasoning
-- ARCHITECTURE.md already gives for why Cursed/On Fire/Bandwagon are
-- code-defined, not configurable).
create type custom_title_metric as enum (
  'win_rate',
  'bet_count',
  'tokens_wagered',
  'payout_multiple',
  'biggest_win',
  'biggest_loss',
  'net',
  'avg_bet_size',
  'distinct_markets_played',
  'markets_created',
  'resolutions_proposed',
  'challenges_raised',
  'votes_cast',
  'reactions_given',
  'times_subject'
);

-- direction is a plain text check rather than a second enum: 'asc'/'desc'
-- has no other meaning anywhere else in the schema worth a named type for,
-- and every metric can take either direction in principle (a metric where
-- only one direction makes sense, e.g. payout_multiple, is a UI menu
-- decision — lib/customAwards.ts only ever offers the sensible pairing —
-- not a database-level restriction).
create table custom_group_titles (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references groups (id) on delete cascade,
  label text not null,
  emoji text not null,
  metric custom_title_metric not null,
  direction text not null check (direction in ('asc', 'desc')),
  created_by uuid references users (id) on delete set null,
  created_at timestamptz not null default now()
);

-- Same "a row always exists, even vacant" convention group_titles uses, so
-- the UI can show "nobody qualifies yet" instead of not knowing whether this
-- has ever been computed. on delete set null on user_id, same as
-- group_titles.user_id: a title holder deleting their account must not be
-- blocked by this table any more than group_titles already isn't (see the
-- notification_events.actor_id fix for the class of bug this avoids).
create table custom_group_title_holders (
  custom_title_id uuid primary key references custom_group_titles (id) on delete cascade,
  user_id uuid references users (id) on delete set null,
  stat_value double precision,
  computed_at timestamptz not null default now()
);

alter table custom_group_titles enable row level security;
create policy custom_group_titles_select on custom_group_titles for select
  to authenticated
  using (
    exists (
      select 1 from memberships m
      where m.group_id = custom_group_titles.group_id and m.user_id = auth.uid()
    )
  );

alter table custom_group_title_holders enable row level security;
create policy custom_group_title_holders_select on custom_group_title_holders for select
  to authenticated
  using (
    exists (
      select 1 from custom_group_titles t
      join memberships m on m.group_id = t.group_id and m.user_id = auth.uid()
      where t.id = custom_group_title_holders.custom_title_id
    )
  );

-- Owner-only, same posture as every other group-configuration action.
-- Capped at 5 per group (lib/limits.ts's CUSTOM_AWARD_MAX_PER_GROUP) purely
-- to bound the added recompute cost every 3rd resolution now carries.
create function create_custom_group_title(
  p_group_id uuid,
  p_label text,
  p_emoji text,
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
  v_emoji text;
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

  v_label := nullif(trim(p_label), '');
  if v_label is null then
    raise exception 'invalid_operation: award name can''t be blank';
  end if;
  if length(v_label) > 30 then
    raise exception 'invalid_operation: award name must be 30 characters or fewer';
  end if;

  v_emoji := nullif(trim(coalesce(p_emoji, '')), '');
  if v_emoji is null then
    raise exception 'invalid_operation: pick an emoji for the award';
  end if;
  if length(v_emoji) > 8 then
    raise exception 'invalid_operation: that doesn''t look like a single emoji';
  end if;

  select count(*) into v_count from custom_group_titles where group_id = p_group_id;
  if v_count >= 5 then
    raise exception 'invalid_operation: a group can have at most 5 custom awards';
  end if;

  insert into custom_group_titles (group_id, label, emoji, metric, direction, created_by)
  values (p_group_id, v_label, v_emoji, p_metric, p_direction, v_caller)
  returning * into v_title;

  insert into custom_group_title_holders (custom_title_id) values (v_title.id);

  -- Computed immediately rather than left vacant until the next 3rd-resolution
  -- batch: an owner who just configured an award wants to see it reflect
  -- reality right away, not wonder whether it worked.
  perform _compute_custom_title(v_title.id);

  return v_title;
end;
$$;

revoke execute on function create_custom_group_title(uuid, text, text, custom_title_metric, text) from public;
grant execute on function create_custom_group_title(uuid, text, text, custom_title_metric, text) to authenticated;

create function delete_custom_group_title(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_title custom_group_titles%rowtype;
  v_owner_id uuid;
begin
  select * into v_title from custom_group_titles where id = p_id;
  if v_title.id is null then
    raise exception 'not_found: award not found';
  end if;

  perform 1 from memberships where group_id = v_title.group_id and user_id = v_caller and status <> 'removed';
  if not found then
    raise exception 'not_found: award not found';
  end if;

  select owner_id into v_owner_id from groups where id = v_title.group_id;
  if v_caller <> v_owner_id then
    raise exception 'forbidden: only the group owner can delete an award';
  end if;

  delete from custom_group_titles where id = p_id;
end;
$$;

revoke execute on function delete_custom_group_title(uuid) from public;
grant execute on function delete_custom_group_title(uuid) to authenticated;

-- _compute_custom_title: the dispatch table for all 15 metrics. Every branch
-- follows the same shape — rank qualifying members by an aggregate, take
-- #1 — with `v_sign` folding asc/desc into a single `order by` expression
-- (`order by v_sign * value`, sign -1 for desc) rather than repeating a
-- direction-aware ORDER BY in every branch. win_rate and avg_bet_size keep
-- a `having count(*) >= 5` floor, the same one Oracle/Ice Cold use, because
-- they're rates that a couple of noisy data points can spike; every
-- count/sum/max-based metric has no floor, since a single real bet, vote,
-- or market genuinely is the fact being reported, not an estimate of one.
-- Every branch restricts to `memberships.status = 'active'`, matching the
-- fixed 8 titles' own "restricted to still-active memberships" rule.
create function _compute_custom_title(p_custom_title_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_title custom_group_titles%rowtype;
  v_group_id uuid;
  v_sign int;
  v_winner_id uuid;
  v_stat_value double precision;
begin
  select * into v_title from custom_group_titles where id = p_custom_title_id;
  if v_title.id is null then
    return;
  end if;
  v_group_id := v_title.group_id;
  v_sign := case when v_title.direction = 'desc' then -1 else 1 end;
  v_winner_id := null;
  v_stat_value := null;

  if v_title.metric = 'win_rate' then
    select t.user_id, t.rate into v_winner_id, v_stat_value
    from (
      select b.user_id,
             avg((case when b.option_id is not null then b.option_id = m.outcome_option_id else b.side::text = m.outcome::text end)::int)::double precision as rate
      from bets b
      join markets m on m.id = b.market_id
      join memberships mem on mem.group_id = m.group_id and mem.user_id = b.user_id and mem.status = 'active'
      where m.group_id = v_group_id and m.status = 'resolved'
      group by b.user_id
      having count(*) >= 5
    ) t
    order by v_sign * t.rate
    limit 1;

  elsif v_title.metric = 'bet_count' then
    select t.user_id, t.n into v_winner_id, v_stat_value
    from (
      select b.user_id, count(*)::double precision as n
      from bets b
      join markets m on m.id = b.market_id
      join memberships mem on mem.group_id = m.group_id and mem.user_id = b.user_id and mem.status = 'active'
      where m.group_id = v_group_id
      group by b.user_id
    ) t
    order by v_sign * t.n
    limit 1;

  elsif v_title.metric = 'tokens_wagered' then
    select t.user_id, t.total into v_winner_id, v_stat_value
    from (
      select b.user_id, sum(b.amount)::double precision as total
      from bets b
      join markets m on m.id = b.market_id
      join memberships mem on mem.group_id = m.group_id and mem.user_id = b.user_id and mem.status = 'active'
      where m.group_id = v_group_id
      group by b.user_id
    ) t
    order by v_sign * t.total
    limit 1;

  elsif v_title.metric = 'payout_multiple' then
    select t.user_id, t.multiple into v_winner_id, v_stat_value
    from (
      select b.user_id, (b.payout::double precision / b.amount) as multiple
      from bets b
      join markets m on m.id = b.market_id
      join memberships mem on mem.group_id = m.group_id and mem.user_id = b.user_id and mem.status = 'active'
      where m.group_id = v_group_id and b.payout is not null and b.payout > b.amount
    ) t
    order by v_sign * t.multiple
    limit 1;

  elsif v_title.metric = 'biggest_win' then
    select t.user_id, t.payout into v_winner_id, v_stat_value
    from (
      select b.user_id, b.payout::double precision as payout
      from bets b
      join markets m on m.id = b.market_id
      join memberships mem on mem.group_id = m.group_id and mem.user_id = b.user_id and mem.status = 'active'
      where m.group_id = v_group_id and b.payout is not null and b.payout > b.amount
    ) t
    order by v_sign * t.payout
    limit 1;

  elsif v_title.metric = 'biggest_loss' then
    select t.user_id, t.amount into v_winner_id, v_stat_value
    from (
      select b.user_id, b.amount::double precision as amount
      from bets b
      join markets m on m.id = b.market_id
      join memberships mem on mem.group_id = m.group_id and mem.user_id = b.user_id and mem.status = 'active'
      where m.group_id = v_group_id and m.status = 'resolved' and b.payout = 0
    ) t
    order by v_sign * t.amount
    limit 1;

  elsif v_title.metric = 'net' then
    select t.user_id, t.net into v_winner_id, v_stat_value
    from (
      select mem.user_id, coalesce(sum(l.amount), 0)::double precision as net
      from memberships mem
      left join ledger l on l.membership_id = mem.id and l.reason <> 'seed'
      where mem.group_id = v_group_id and mem.status = 'active'
      group by mem.user_id
    ) t
    order by v_sign * t.net
    limit 1;

  elsif v_title.metric = 'avg_bet_size' then
    select t.user_id, t.avg_amount into v_winner_id, v_stat_value
    from (
      select b.user_id, avg(b.amount)::double precision as avg_amount
      from bets b
      join markets m on m.id = b.market_id
      join memberships mem on mem.group_id = m.group_id and mem.user_id = b.user_id and mem.status = 'active'
      where m.group_id = v_group_id
      group by b.user_id
      having count(*) >= 5
    ) t
    order by v_sign * t.avg_amount
    limit 1;

  elsif v_title.metric = 'distinct_markets_played' then
    select t.user_id, t.n into v_winner_id, v_stat_value
    from (
      select b.user_id, count(distinct b.market_id)::double precision as n
      from bets b
      join markets m on m.id = b.market_id
      join memberships mem on mem.group_id = m.group_id and mem.user_id = b.user_id and mem.status = 'active'
      where m.group_id = v_group_id
      group by b.user_id
    ) t
    order by v_sign * t.n
    limit 1;

  elsif v_title.metric = 'markets_created' then
    select t.user_id, t.n into v_winner_id, v_stat_value
    from (
      select mk.creator_id as user_id, count(*)::double precision as n
      from markets mk
      join memberships mem on mem.group_id = mk.group_id and mem.user_id = mk.creator_id and mem.status = 'active'
      where mk.group_id = v_group_id
      group by mk.creator_id
    ) t
    order by v_sign * t.n
    limit 1;

  elsif v_title.metric = 'resolutions_proposed' then
    select t.user_id, t.n into v_winner_id, v_stat_value
    from (
      select rp.proposer_id as user_id, count(*)::double precision as n
      from resolution_proposals rp
      join markets m on m.id = rp.market_id
      join memberships mem on mem.group_id = m.group_id and mem.user_id = rp.proposer_id and mem.status = 'active'
      where m.group_id = v_group_id
      group by rp.proposer_id
    ) t
    order by v_sign * t.n
    limit 1;

  elsif v_title.metric = 'challenges_raised' then
    select t.user_id, t.n into v_winner_id, v_stat_value
    from (
      select c.challenger_id as user_id, count(*)::double precision as n
      from challenges c
      join markets m on m.id = c.market_id
      join memberships mem on mem.group_id = m.group_id and mem.user_id = c.challenger_id and mem.status = 'active'
      where m.group_id = v_group_id
      group by c.challenger_id
    ) t
    order by v_sign * t.n
    limit 1;

  elsif v_title.metric = 'votes_cast' then
    select t.user_id, t.n into v_winner_id, v_stat_value
    from (
      select v.voter_id as user_id, count(*)::double precision as n
      from votes v
      join markets m on m.id = v.market_id
      join memberships mem on mem.group_id = m.group_id and mem.user_id = v.voter_id and mem.status = 'active'
      where m.group_id = v_group_id
      group by v.voter_id
    ) t
    order by v_sign * t.n
    limit 1;

  elsif v_title.metric = 'reactions_given' then
    select t.user_id, t.n into v_winner_id, v_stat_value
    from (
      select mr.user_id, count(*)::double precision as n
      from market_reactions mr
      join markets m on m.id = mr.market_id
      join memberships mem on mem.group_id = m.group_id and mem.user_id = mr.user_id and mem.status = 'active'
      where m.group_id = v_group_id
      group by mr.user_id
    ) t
    order by v_sign * t.n
    limit 1;

  elsif v_title.metric = 'times_subject' then
    -- Restricted to resolved/voided markets only — subject status is
    -- invisible pre-resolution even here, same rule is_market_visible()
    -- enforces everywhere else. A market still open never contributes.
    select t.user_id, t.n into v_winner_id, v_stat_value
    from (
      select ms.user_id, count(*)::double precision as n
      from market_subjects ms
      join markets m on m.id = ms.market_id
      join memberships mem on mem.group_id = m.group_id and mem.user_id = ms.user_id and mem.status = 'active'
      where m.group_id = v_group_id and m.status in ('resolved', 'voided')
      group by ms.user_id
    ) t
    order by v_sign * t.n
    limit 1;
  end if;

  update custom_group_title_holders
  set user_id = v_winner_id, stat_value = v_stat_value, computed_at = now()
  where custom_title_id = p_custom_title_id;
end;
$$;

revoke execute on function _compute_custom_title(uuid) from public;
revoke execute on function _compute_custom_title(uuid) from authenticated;

-- Loops a group's custom titles on the exact same cadence the fixed 8 use
-- (see _bump_titles_counter below) and fires the existing group_titles_updated
-- push if any holder actually changed — reusing the event rather than adding
-- a new type, since "The Awards just shuffled" already covers this honestly.
create function _recompute_custom_group_titles(p_group_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  rec record;
  v_old_holder uuid;
  v_new_holder uuid;
  v_changed boolean := false;
begin
  for rec in select id from custom_group_titles where group_id = p_group_id loop
    select user_id into v_old_holder from custom_group_title_holders where custom_title_id = rec.id;
    perform _compute_custom_title(rec.id);
    select user_id into v_new_holder from custom_group_title_holders where custom_title_id = rec.id;
    if v_new_holder is distinct from v_old_holder then
      v_changed := true;
    end if;
  end loop;

  if v_changed then
    perform _emit_notification_event('group_titles_updated', p_group_id);
  end if;
end;
$$;

revoke execute on function _recompute_custom_group_titles(uuid) from public;
revoke execute on function _recompute_custom_group_titles(uuid) from authenticated;

-- _bump_titles_counter: same signature, same cadence (every 3rd resolved
-- market), just also recomputes custom titles alongside the fixed 8 —
-- one shared batching counter for both, rather than a second column and a
-- second cadence to keep in sync with this one.
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
    perform _recompute_custom_group_titles(p_group_id);
  end if;
end;
$$;
