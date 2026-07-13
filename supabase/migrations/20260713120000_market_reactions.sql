-- Reactions on a resolved/voided market's reveal ticket: one fixed emoji per
-- person per market, not stackable. Tapping a new emoji swaps the pick;
-- tapping the current pick again removes it. No push notification.
create type reaction_emoji as enum ('fire', 'laugh', 'clown', 'salute', 'thumbs_up', 'thumbs_down');

create table market_reactions (
  market_id uuid not null references markets (id) on delete cascade,
  user_id uuid not null references users (id) on delete cascade,
  emoji reaction_emoji not null,
  created_at timestamptz not null default now(),
  primary key (market_id, user_id)
);

alter table market_reactions enable row level security;

-- Same choke point as every other subject-sensitive table: is_market_visible()
-- already lifts the subject-gate the instant a market is resolved/voided,
-- which is the only state reactions are ever allowed to exist in anyway.
create policy market_reactions_select on market_reactions for select
  to authenticated
  using (is_market_visible(market_id));

-- react_to_market: upserts like cast_vote's on-conflict idiom, but also
-- deletes the row outright when the caller re-selects their current pick
-- (no existing function in this codebase needs that branch, since votes only
-- ever swap, never clear). Returns the resulting emoji, or null if removed.
create or replace function react_to_market(p_market_id uuid, p_emoji reaction_emoji)
returns reaction_emoji
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_market markets%rowtype;
  v_existing reaction_emoji;
begin
  if not is_market_visible(p_market_id, v_user_id) then
    raise exception 'not_found: market not found';
  end if;

  select * into v_market from markets where id = p_market_id;
  if v_market.status not in ('resolved', 'voided') then
    raise exception 'invalid_operation: reactions open once the market resolves';
  end if;

  select emoji into v_existing from market_reactions where market_id = p_market_id and user_id = v_user_id;

  if v_existing is not distinct from p_emoji then
    delete from market_reactions where market_id = p_market_id and user_id = v_user_id;
    return null;
  end if;

  insert into market_reactions (market_id, user_id, emoji)
  values (p_market_id, v_user_id, p_emoji)
  on conflict (market_id, user_id) do update set emoji = excluded.emoji, created_at = now();
  return p_emoji;
end;
$$;

revoke execute on function react_to_market(uuid, reaction_emoji) from public;
grant execute on function react_to_market(uuid, reaction_emoji) to authenticated;
