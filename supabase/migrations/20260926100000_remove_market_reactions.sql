-- Removes market-level reactions (react_to_market / market_reactions) outright, per explicit
-- product direction: the feature is gone, not hidden behind a flag. Comment reactions
-- (react_to_comment / comment_reactions) are a separate, unrelated feature and are untouched --
-- they happen to reuse the same reaction_emoji enum this migration leaves in place for exactly
-- that reason.
--
-- Two real cleanup steps have to happen before the drop, not after:
--
-- 1. The 'reactions_given' custom-award metric (lib/customAwards.ts) queried market_reactions
--    directly inside _compute_custom_title, so dropping the table out from under it would break
--    that branch the next time it ran. The app no longer offers this metric in the create-award
--    menu, but any group that had already configured it still has a real row in
--    custom_group_titles/custom_group_title_holders -- those are deleted here rather than left to
--    silently go permanently vacant (nobody would ever be told why "Most reactions given" stopped
--    naming a holder). A group owner who had this configured loses that one custom award; nothing
--    else about their other awards changes.
-- 2. _compute_custom_title is redeclared from the exact body in 20260822180000_custom_group_titles.sql
--    (confirmed via `grep -rl _compute_custom_title supabase/migrations/` -- no later migration
--    redeclares it, only calls it, so that original file is genuinely the current definition, not
--    a stale one) with the 'reactions_given' branch removed. If a stray row's metric were ever
--    'reactions_given' after this (it can't be, per the delete above, and create_custom_group_title
--    can no longer be called with it from the app), the if/elsif chain simply falls through with
--    v_winner_id/v_stat_value left null, computing to "vacant" rather than erroring -- the same
--    fallback every other unmatched case already gets.
--
-- What's deliberately left behind: the reaction_emoji enum type (comment_reactions still depends
-- on it) and custom_title_metric's own 'reactions_given' value (Postgres has no `drop value` for
-- an enum; recreating the type to shed one dead value is a bigger, riskier migration than a
-- permanently-unused label is worth). Neither is reachable from the app going forward.

delete from custom_group_title_holders
where custom_title_id in (select id from custom_group_titles where metric = 'reactions_given');

delete from custom_group_titles where metric = 'reactions_given';

create or replace function _compute_custom_title(p_custom_title_id uuid)
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

drop function react_to_market(uuid, reaction_emoji);
drop table market_reactions;
