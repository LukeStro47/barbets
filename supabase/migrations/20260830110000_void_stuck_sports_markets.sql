-- One-time cleanup for the Odds API quota outage (see 20260830100000): 14 Sports markets got
-- stuck in 'open'/'closed' because sports-resolve-markets couldn't fetch scores while the
-- account was OUT_OF_USAGE_CREDITS. Rather than wait for credits to reset and risk some of these
-- games aging out of the resolve function's DAYS_FROM lookback window, void them all directly via
-- _resolve_system_market(..., 'void') -- the same actor-less path the pipeline itself uses,
-- callable here because it never reads auth.uid(). All but one of the 14 had zero bets; the one
-- with a single bet gets that bet refunded by the normal void path, same as any other void.
do $$
declare
  v_group_id uuid;
  rec record;
begin
  select id into v_group_id from groups where name = 'Sports' and is_public = true;

  for rec in
    select id from markets
    where group_id = v_group_id
      and is_system_market = true
      and status in ('open', 'closed')
  loop
    perform _resolve_system_market(rec.id, 'void');
  end loop;
end;
$$;
