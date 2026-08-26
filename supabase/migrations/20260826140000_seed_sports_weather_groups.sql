-- One-time seed for the two public groups the Sports and Weather pipelines post into.
-- create_public_group() can't be called directly here -- it requires a live auth.uid() via
-- is_platform_admin(v_user_id), which a migration has none of -- so this replicates its insert
-- shape directly (groups + group_settings, no membership row, matching what
-- create_public_group() itself does when p_nickname is omitted: admin manages purely from
-- /admin). Same "look up a real user by email inside a migration" pattern as the app_admins seed
-- (20260805160000).
--
-- Guarded rather than assumed: staging and any other environment that doesn't have this account
-- (or already has these groups) skips cleanly with a notice instead of failing the whole
-- migration, matching the pg_cron scheduling migrations' own guarded-DDL convention.
do $$
declare
  v_owner_id uuid;
  v_group_id uuid;
begin
  select id into v_owner_id from auth.users where email = 'lukestrong47@gmail.com';

  if v_owner_id is null then
    raise notice 'Skipping Sports/Weather group seed: no account found for the configured owner email.';
    return;
  end if;

  if not exists (select 1 from groups where name = 'Sports' and owner_id = v_owner_id) then
    insert into groups (name, owner_id, invite_code, is_public, category, avatar_key)
    values ('Sports', v_owner_id, _generate_invite_code(), true, 'generic', 'football')
    returning id into v_group_id;

    insert into group_settings (
      group_id, seed_amount, seasons_enabled, timezone, betting_enabled, accepting_members,
      allow_hedged_bets, require_endorsement, awards_enabled, distribute_payout, creator_payout_pct
    )
    values (v_group_id, 1000, false, 'America/New_York', true, true, false, false, false, true, 0);
  end if;

  if not exists (select 1 from groups where name = 'Weather' and owner_id = v_owner_id) then
    insert into groups (name, owner_id, invite_code, is_public, category, avatar_key)
    values ('Weather', v_owner_id, _generate_invite_code(), true, 'generic', 'weather')
    returning id into v_group_id;

    insert into group_settings (
      group_id, seed_amount, seasons_enabled, timezone, betting_enabled, accepting_members,
      allow_hedged_bets, require_endorsement, awards_enabled, distribute_payout, creator_payout_pct
    )
    values (v_group_id, 1000, false, 'America/New_York', true, true, false, false, false, true, 0);
  end if;
end;
$$;
