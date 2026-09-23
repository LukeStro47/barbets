-- Threaded comments on a market, plus a per-comment reaction and a
-- "reveal your bet into the thread" action. Modeled directly on
-- market_reactions (20260713120000): same is_market_visible() choke point,
-- same SECURITY DEFINER + explicit anon revoke shape, same toggle-on-repeat
-- idiom for reactions.
--
-- revealed_side/revealed_option_id/revealed_amount are a SNAPSHOT copy of
-- the caller's own bet at the moment they choose to reveal it, written by
-- reveal_bet_in_comment() below -- never a live join back to bets. This is
-- deliberate: bets_select's RLS policy is what actually keeps other
-- members' bets sealed while a market is open (a real database guarantee,
-- not just a UI hide), and "reveal your bet" must not touch that policy or
-- read someone else's bet row. The snapshot is a copy of data the caller
-- can already read (their own bet, always visible to them via
-- `user_id = auth.uid()`), so revealing it never grants any new read access
-- to bets, only publishes a copy of what the revealer chose to publish.

create table market_comments (
  id uuid primary key default gen_random_uuid(),
  market_id uuid not null references markets (id) on delete cascade,
  user_id uuid not null references users (id) on delete cascade,
  body text not null,
  revealed_side bet_side,
  revealed_option_id uuid references market_options (id) on delete set null,
  revealed_amount int check (revealed_amount is null or revealed_amount >= 1),
  created_at timestamptz not null default now(),
  deleted_at timestamptz,

  constraint market_comments_revealed_side_xor_option check (
    revealed_side is null or revealed_option_id is null
  ),
  -- A revealed bet is either fully specified (side-or-option, and an
  -- amount) or not revealed at all (an ordinary comment) -- never a partial
  -- snapshot that would misrepresent what was actually staked.
  constraint market_comments_revealed_amount_matches_pick check (
    (revealed_amount is not null) = (revealed_side is not null or revealed_option_id is not null)
  )
);

create index idx_market_comments_market_created on market_comments (market_id, created_at) where deleted_at is null;

create table comment_reactions (
  comment_id uuid not null references market_comments (id) on delete cascade,
  user_id uuid not null references users (id) on delete cascade,
  emoji reaction_emoji not null,
  created_at timestamptz not null default now(),
  primary key (comment_id, user_id)
);

alter table market_comments enable row level security;
alter table comment_reactions enable row level security;

-- Same single-line predicate the majority of market-scoped tables use --
-- comments aren't secret from the commenter's own view the way a sealed
-- ballot is, so there's no "always see your own row" clause to add on top,
-- unlike bets/votes. No client-facing write policy on either table: all
-- mutation goes through the SECURITY DEFINER functions below.
create policy market_comments_select on market_comments for select
  to authenticated
  using (is_market_visible(market_id));

-- comment_reactions has no market_id of its own, so its visibility is
-- resolved through the comment it reacts to.
create policy comment_reactions_select on comment_reactions for select
  to authenticated
  using (
    exists (
      select 1 from market_comments mc
      where mc.id = comment_reactions.comment_id
        and is_market_visible(mc.market_id)
    )
  );

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

  return v_comment;
end;
$$;

revoke execute on function post_market_comment(uuid, text) from public;
revoke execute on function post_market_comment(uuid, text) from anon;
grant execute on function post_market_comment(uuid, text) to authenticated;

-- reveal_bet_in_comment: the caller's own bet is already readable to them
-- under bets_select's "user_id = auth.uid()" clause regardless of market
-- status, so no new read access is granted here -- this only copies what
-- they can already see into a comment they're choosing to post.
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

  return v_comment;
end;
$$;

revoke execute on function reveal_bet_in_comment(uuid, text) from public;
revoke execute on function reveal_bet_in_comment(uuid, text) from anon;
grant execute on function reveal_bet_in_comment(uuid, text) to authenticated;

create or replace function delete_market_comment(p_comment_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_comment market_comments%rowtype;
begin
  select * into v_comment from market_comments where id = p_comment_id and deleted_at is null;
  if v_comment.id is null then
    raise exception 'not_found: comment not found';
  end if;

  if not is_market_visible(v_comment.market_id, v_user_id) then
    raise exception 'not_found: comment not found';
  end if;

  if v_comment.user_id <> v_user_id then
    raise exception 'forbidden: you can only delete your own comment';
  end if;

  update market_comments set deleted_at = now() where id = p_comment_id;
end;
$$;

revoke execute on function delete_market_comment(uuid) from public;
revoke execute on function delete_market_comment(uuid) from anon;
grant execute on function delete_market_comment(uuid) to authenticated;

-- react_to_comment: same upsert/toggle-on-repeat idiom as react_to_market,
-- except a comment reaction is open the instant the comment exists (there's
-- no "wait for resolution" gate the way market_reactions has, since a
-- comment isn't sealed data the way a market's odds are).
create or replace function react_to_comment(p_comment_id uuid, p_emoji reaction_emoji)
returns reaction_emoji
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_comment market_comments%rowtype;
  v_existing reaction_emoji;
begin
  select * into v_comment from market_comments where id = p_comment_id and deleted_at is null;
  if v_comment.id is null then
    raise exception 'not_found: comment not found';
  end if;

  if not is_market_visible(v_comment.market_id, v_user_id) then
    raise exception 'not_found: comment not found';
  end if;

  select emoji into v_existing from comment_reactions where comment_id = p_comment_id and user_id = v_user_id;

  if v_existing is not distinct from p_emoji then
    delete from comment_reactions where comment_id = p_comment_id and user_id = v_user_id;
    return null;
  end if;

  insert into comment_reactions (comment_id, user_id, emoji)
  values (p_comment_id, v_user_id, p_emoji)
  on conflict (comment_id, user_id) do update set emoji = excluded.emoji, created_at = now();
  return p_emoji;
end;
$$;

revoke execute on function react_to_comment(uuid, reaction_emoji) from public;
revoke execute on function react_to_comment(uuid, reaction_emoji) from anon;
grant execute on function react_to_comment(uuid, reaction_emoji) to authenticated;
