-- Notify on an @mention inside a comment, not on every comment -- matching
-- the restraint market_reactions already established (reactions push no one
-- at all: "a resolved market's reveal ticket is a low-stakes... surface, not
-- something worth interrupting anyone for"; a comment thread on an open
-- market is a step above that, but still not "buzz every member on every
-- reply"). Mention detection is deliberately simple: any @token in the body
-- that case-insensitively matches an active member's nickname counts, with
-- no attempt to resolve exactly which member(s) were meant.
--
-- Recipients therefore go through the same get_notification_recipients()
-- every other market-scoped event already uses (subject-exclusion baked
-- in), rather than a single-recipient "only the mentioned person" path --
-- deliberately the simpler, already-proven-safe shape rather than a new,
-- narrower one. A comment that happens to mention someone reaches the same
-- audience market_needs_endorsement/resolution_proposed/etc. already do,
-- with the commenter themself excluded via the usual actor_id rule in
-- get_event_recipients(). Revisit toward a true single-recipient send if
-- comment volume ever makes that broader reach feel noisy.

create or replace function post_market_comment(p_market_id uuid, p_body text)
returns market_comments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_body text := trim(p_body);
  v_comment market_comments%rowtype;
  v_market markets%rowtype;
  v_has_mention boolean;
begin
  if not is_market_visible(p_market_id, v_user_id) then
    raise exception 'not_found: market not found';
  end if;

  if v_body = '' or char_length(v_body) > 2000 then
    raise exception 'invalid_operation: a comment has to be between 1 and 2000 characters';
  end if;

  insert into market_comments (market_id, user_id, body)
  values (p_market_id, v_user_id, v_body)
  returning * into v_comment;

  select * into v_market from markets where id = p_market_id;

  select exists (
    select 1
    from regexp_matches(v_body, '@([A-Za-z0-9_]+)', 'g') as tok
    join memberships m on m.group_id = v_market.group_id and m.status not in ('removed', 'left')
    where lower(m.nickname) = lower(tok[1])
  ) into v_has_mention;

  if v_has_mention then
    perform _emit_notification_event('market_comment_mention', v_market.group_id, p_market_id, null, v_user_id);
  end if;

  return v_comment;
end;
$$;

revoke execute on function post_market_comment(uuid, text) from public;
revoke execute on function post_market_comment(uuid, text) from anon;
grant execute on function post_market_comment(uuid, text) to authenticated;

create or replace function reveal_bet_in_comment(p_market_id uuid, p_body text)
returns market_comments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_body text := trim(p_body);
  v_bet bets%rowtype;
  v_comment market_comments%rowtype;
  v_market markets%rowtype;
  v_has_mention boolean;
begin
  if not is_market_visible(p_market_id, v_user_id) then
    raise exception 'not_found: market not found';
  end if;

  select * into v_bet from bets where market_id = p_market_id and user_id = v_user_id limit 1;
  if v_bet.id is null then
    raise exception 'invalid_operation: you have no bet on this market to reveal';
  end if;

  if v_body = '' or char_length(v_body) > 2000 then
    raise exception 'invalid_operation: a comment has to be between 1 and 2000 characters';
  end if;

  insert into market_comments (market_id, user_id, body, revealed_side, revealed_option_id, revealed_amount)
  values (p_market_id, v_user_id, v_body, v_bet.side, v_bet.option_id, v_bet.amount)
  returning * into v_comment;

  select * into v_market from markets where id = p_market_id;

  select exists (
    select 1
    from regexp_matches(v_body, '@([A-Za-z0-9_]+)', 'g') as tok
    join memberships m on m.group_id = v_market.group_id and m.status not in ('removed', 'left')
    where lower(m.nickname) = lower(tok[1])
  ) into v_has_mention;

  if v_has_mention then
    perform _emit_notification_event('market_comment_mention', v_market.group_id, p_market_id, null, v_user_id);
  end if;

  return v_comment;
end;
$$;

revoke execute on function reveal_bet_in_comment(uuid, text) from public;
revoke execute on function reveal_bet_in_comment(uuid, text) from anon;
grant execute on function reveal_bet_in_comment(uuid, text) to authenticated;
