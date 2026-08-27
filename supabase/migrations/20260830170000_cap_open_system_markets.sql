-- One-time cleanup for the new 3-open-market-per-group cap now enforced going forward in
-- weather-create-markets/sports-create-markets themselves (nothing DB-side needs to know about
-- that cap, since it only governs what the pipelines choose to create). This migration just
-- brings the two groups' *existing* open backlog down to it immediately: for each of Sports and
-- Weather, keeps the 3 open system markets with the soonest closes_at and voids the rest via
-- _resolve_system_market(..., 'void') -- the same actor-less path 20260830110000 used, which
-- correctly refunds any bets on what gets voided rather than a raw status UPDATE.
--
-- Also runs the existing _prune_resolved_system_markets() (20260830120000) directly rather than
-- waiting for the next scheduled resolve run, to clear each group's settled (resolved/voided)
-- backlog past its cap of 10 right away -- the newly-voided rows above included.
do $$
declare
  v_group record;
  rec record;
begin
  for v_group in
    select id from groups where name in ('Sports', 'Weather') and is_public = true
  loop
    for rec in
      select id from markets
      where group_id = v_group.id
        and is_system_market = true
        and status = 'open'
      order by closes_at asc
      offset 3
    loop
      perform _resolve_system_market(rec.id, 'void');
    end loop;
  end loop;
end;
$$;

select _prune_resolved_system_markets();
