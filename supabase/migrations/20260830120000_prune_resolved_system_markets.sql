-- Caps Sports and Weather at the 10 most recently resolved/voided markets each, deleting anything
-- older once a pipeline's resolve run pushes past that. Every other table referencing markets
-- already cascades on delete (bets, resolution_proposals, notification_events, market_options,
-- market_reactions, criteria_clarifications, market_subjects) except ledger.market_id, which was
-- left with no delete action so a market with real bet history couldn't be dropped by accident.
-- This is a deliberate choice to allow it here: these are low-stakes auto-generated system-board
-- markets, not a private group's real history, and the user chose "delete anyway" over keeping the
-- append-only ledger's audit trail for the handful of bets these ever attract. Deleting a ledger
-- row does not touch memberships.balance -- that was already updated at bet/payout/refund time --
-- so no one's current balance changes, only the historical "why" for that one entry disappears.
alter table ledger drop constraint if exists ledger_market_id_fkey;
alter table ledger add constraint ledger_market_id_fkey
  foreign key (market_id) references markets (id) on delete cascade;

create or replace function _prune_resolved_system_markets()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group record;
  v_market record;
begin
  for v_group in
    select id from groups where name in ('Sports', 'Weather') and is_public = true
  loop
    for v_market in
      select id from markets
      where group_id = v_group.id
        and is_system_market = true
        and status in ('resolved', 'voided')
      order by resolved_at desc
      offset 10
    loop
      delete from markets where id = v_market.id;
    end loop;
  end loop;
end;
$$;

revoke execute on function _prune_resolved_system_markets() from public;
revoke execute on function _prune_resolved_system_markets() from authenticated;
grant execute on function _prune_resolved_system_markets() to service_role;
