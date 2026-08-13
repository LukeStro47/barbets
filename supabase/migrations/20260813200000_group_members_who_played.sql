-- "Which of these departed members ever actually played?" as a question the
-- caller is allowed to ask about someone else.
--
-- The leaderboard keeps a member who has left only if they really played,
-- which it decides by ORing two reads: did they place a bet, and do they have
-- any non-seed ledger entry. The second half has never worked. `ledger_select_own`
-- is own-rows-only, so a read of another member's ledger rows returns nothing
-- for every viewer, and the OR quietly collapsed to the bets half alone. The
-- case the ledger half exists for -- someone who never bet but took a
-- creator/endorser payout cut -- was therefore never caught, and a departed
-- member whose bets were all still unresolved (bets_select only exposes other
-- people's bets on resolved/voided markets) dropped off the board until those
-- markets settled.
--
-- This is the deliberate privacy decision that fix needs, kept as narrow as it
-- can be: the function returns **membership ids and nothing else**, never an
-- amount, never a count, never a date. The single bit it discloses ("this
-- person played") is already exactly what their presence on the leaderboard
-- tells you, so the answer reveals nothing the feature doesn't publish anyway.
-- A function returning their net, or their weekly swing, would be a genuinely
-- different decision and is not this one.
--
-- Two things keep the disclosure bounded, and both matter:
--   * `_caller_is_active_group_member(p_group_id)` gates the whole thing, so a
--     non-member (or a removed/left one) gets no rows at all rather than a
--     distinguishable error -- the same 404-never-403 shape as every other read.
--   * `m.group_id = p_group_id` is checked per row, so passing membership ids
--     that belong to some *other* group answers nothing about them. Without it
--     the id list itself would become an oracle.

create or replace function group_members_who_played(p_group_id uuid, p_membership_ids uuid[])
returns table (played_membership_id uuid)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not _caller_is_active_group_member(p_group_id) then
    return;
  end if;

  return query
  select m.id
  from memberships m
  where m.group_id = p_group_id
    and m.id = any(p_membership_ids)
    and exists (
      select 1 from ledger l
      where l.membership_id = m.id and l.reason <> 'seed'
    );
end;
$$;

revoke execute on function group_members_who_played(uuid, uuid[]) from public;
grant execute on function group_members_who_played(uuid, uuid[]) to authenticated;

-- The OUT column is named played_membership_id rather than membership_id on
-- purpose: inside a plpgsql function a RETURNS TABLE column name is also a
-- variable, and an unqualified `membership_id` in the body would then be
-- ambiguous against ledger.membership_id. Every reference below is qualified
-- anyway, but the distinct name means a later edit can't reintroduce that trap
-- by dropping an alias.
