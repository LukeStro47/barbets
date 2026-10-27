-- 4e: "Show the group your bet" sits under a comment you've already posted,
-- with a Reveal button that attaches your bet to *that* comment. Until now the
-- only way to reveal was reveal_bet_in_comment(), which posts a brand-new
-- comment, so revealing meant writing something twice.
--
-- Same snapshot model as reveal_bet_in_comment() (see 20260923100000): the
-- caller's own bet is copied onto the comment once, never joined live, so
-- bets_select's sealing is untouched. Same visibility choke point too.
--
-- Rules beyond the visibility check:
--   * the comment must be the caller's own and not deleted. Someone else's
--     comment raises the same not_found as a missing one (404, never 403);
--   * the comment must not already carry a reveal (revealing is one-way and
--     permanent, and a second copy on the same comment would overwrite it);
--   * the caller can only reveal once per market, across all their comments,
--     matching what the UI has always enforced for reveal_bet_in_comment().
--
-- New function rather than a new parameter on reveal_bet_in_comment(), so
-- there's no overload for PostgREST to trip on (see CLAUDE.md).

create or replace function reveal_bet_on_comment(p_comment_id uuid)
returns market_comments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_comment market_comments%rowtype;
  v_bet bets%rowtype;
begin
  select * into v_comment from market_comments where id = p_comment_id and deleted_at is null;
  if v_comment.id is null or v_comment.user_id <> v_user_id then
    raise exception 'not_found: comment not found';
  end if;

  if not is_market_visible(v_comment.market_id, v_user_id) then
    raise exception 'not_found: comment not found';
  end if;

  if v_comment.revealed_amount is not null then
    raise exception 'invalid_operation: your bet is already on this comment';
  end if;

  if exists (
    select 1 from market_comments
    where market_id = v_comment.market_id
      and user_id = v_user_id
      and deleted_at is null
      and revealed_amount is not null
  ) then
    raise exception 'invalid_operation: you have already shown the group your bet on this market';
  end if;

  select * into v_bet from bets where market_id = v_comment.market_id and user_id = v_user_id order by created_at limit 1;
  if v_bet.id is null then
    raise exception 'invalid_operation: you have no bet on this market to reveal';
  end if;

  update market_comments
  set revealed_side = v_bet.side,
      revealed_option_id = v_bet.option_id,
      revealed_amount = v_bet.amount
  where id = p_comment_id
  returning * into v_comment;

  return v_comment;
end;
$$;

revoke execute on function reveal_bet_on_comment(uuid) from public;
revoke execute on function reveal_bet_on_comment(uuid) from anon;
grant execute on function reveal_bet_on_comment(uuid) to authenticated;
