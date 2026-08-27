-- One-time reset, requested directly: wipe every market in Sports and Weather regardless of
-- status (open/closed awaiting resolution, or already resolved/voided) so both groups start
-- completely empty rather than carrying over the backlog 20260830170000 only trimmed down.
--
-- Anything still open/closed goes through _resolve_system_market(..., 'void') first -- the same
-- actor-less path 20260830110000/20260830170000 already used -- so any real bets on it get
-- refunded properly rather than disappearing via a raw delete. Everything is then hard-deleted:
-- safe per 20260830120000's note that every table referencing markets (including ledger, patched
-- there) cascades on delete, and these are low-stakes auto-generated system-board markets, not a
-- private group's real history.
do $$
declare
  v_group record;
  v_market record;
begin
  for v_group in
    select id from groups where name in ('Sports', 'Weather') and is_public = true
  loop
    for v_market in
      select id from markets where group_id = v_group.id and status in ('open', 'closed')
    loop
      perform _resolve_system_market(v_market.id, 'void');
    end loop;

    delete from markets where group_id = v_group.id;
  end loop;
end;
$$;
