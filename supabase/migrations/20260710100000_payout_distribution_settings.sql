-- Optional alternative to the default "everyone refunded" behavior for the
-- one finalize_market() branch where the winning side got zero bets (nobody
-- predicted the actual outcome). When distribute_payout is on, that pool
-- instead rewards the market's creator/endorser and tops up every other
-- currently-open market's pot — see finalize_market() in the next migration
-- for the mechanics. Off by default, so existing groups see no behavior
-- change until the owner opts in.
alter table group_settings add column distribute_payout boolean not null default false;
alter table group_settings add column creator_payout_pct int not null default 25 check (creator_payout_pct between 0 and 100);
alter table group_settings add column endorser_payout_pct int not null default 5 check (endorser_payout_pct between 0 and 100);
alter table group_settings add constraint group_settings_payout_pct_sum check (creator_payout_pct + endorser_payout_pct <= 100);

-- Holds money redistributed in from another market's zero-winner-pool split
-- (see finalize_market()) until this market itself resolves — folded into
-- that market's own total_pool at finalize time, same as a bettor's stake,
-- just not owned by any one bettor. Never set directly by client code. Same
-- int type as bets.amount/memberships.balance, which it's always summed
-- with.
alter table markets add column bonus_pool int not null default 0 check (bonus_pool >= 0);

-- Same lesson as every prior signature change: drop the old 8-param
-- overload explicitly rather than letting CREATE OR REPLACE leave it behind.
drop function if exists update_group_settings(uuid, int, boolean, season_length, text, boolean, boolean);

create or replace function update_group_settings(
  p_group_id uuid,
  p_seed_amount int,
  p_seasons_enabled boolean,
  p_season_length season_length default null,
  p_timezone text default 'UTC',
  p_betting_enabled boolean default false,
  p_accepting_members boolean default true,
  p_distribute_payout boolean default false,
  p_creator_payout_pct int default 25,
  p_endorser_payout_pct int default 5
) returns group_settings
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_group groups%rowtype;
  v_settings group_settings%rowtype;
  v_was_betting_enabled boolean;
begin
  select * into v_group from groups where id = p_group_id;
  if v_group.id is null then
    raise exception 'not_found: group not found';
  end if;

  perform 1 from memberships where group_id = p_group_id and user_id = v_caller and status <> 'removed';
  if not found then
    raise exception 'not_found: group not found';
  end if;

  if v_caller <> v_group.owner_id then
    raise exception 'forbidden: only the group owner can edit settings';
  end if;

  if not exists (select 1 from pg_timezone_names where name = p_timezone) then
    raise exception 'invalid_operation: unrecognized time zone';
  end if;

  if p_creator_payout_pct < 0 or p_creator_payout_pct > 100 or p_endorser_payout_pct < 0 or p_endorser_payout_pct > 100 then
    raise exception 'invalid_operation: payout percentages must be between 0 and 100';
  end if;
  if p_creator_payout_pct + p_endorser_payout_pct > 100 then
    raise exception 'invalid_operation: creator and endorser percentages cannot add up to more than 100';
  end if;

  select * into v_settings from group_settings where group_id = p_group_id;
  v_was_betting_enabled := v_settings.betting_enabled;

  if v_settings.seasons_enabled and not p_seasons_enabled then
    raise exception 'invalid_operation: seasons cannot be turned off once enabled';
  end if;

  update group_settings
  set seed_amount = p_seed_amount,
      seasons_enabled = p_seasons_enabled,
      season_length = p_season_length,
      timezone = p_timezone,
      betting_enabled = p_betting_enabled,
      accepting_members = p_accepting_members,
      distribute_payout = p_distribute_payout,
      creator_payout_pct = p_creator_payout_pct,
      endorser_payout_pct = p_endorser_payout_pct
  where group_id = p_group_id
  returning * into v_settings;

  if p_seasons_enabled and not exists (select 1 from seasons where group_id = p_group_id) then
    insert into seasons (group_id, number, status, seed_amount)
    values (p_group_id, 1, 'active', p_seed_amount);
  end if;

  if p_betting_enabled and not v_was_betting_enabled then
    perform _emit_notification_event('betting_opened', p_group_id, null, null, v_caller);
  end if;

  return v_settings;
end;
$$;

revoke execute on function update_group_settings(uuid, int, boolean, season_length, text, boolean, boolean, boolean, int, int) from public;
grant execute on function update_group_settings(uuid, int, boolean, season_length, text, boolean, boolean, boolean, int, int) to authenticated;
