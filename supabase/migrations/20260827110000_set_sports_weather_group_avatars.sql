-- The Sports/Weather pipeline groups (seeded in 20260826140000) went out without an avatar_key.
-- Set them now that dedicated 'football' and 'weather' icons exist in lib/avatars.ts. A plain
-- update rather than editing the seed migration, since that migration already ran on production
-- and staging and won't be re-applied.
--
-- Guarded the same way as the seed: skips cleanly if the configured owner account doesn't exist
-- in this environment.
do $$
declare
  v_owner_id uuid;
begin
  select id into v_owner_id from auth.users where email = 'lukestrong47@gmail.com';

  if v_owner_id is null then
    raise notice 'Skipping Sports/Weather avatar update: no account found for the configured owner email.';
    return;
  end if;

  update groups set avatar_key = 'football' where name = 'Sports' and owner_id = v_owner_id;
  update groups set avatar_key = 'weather' where name = 'Weather' and owner_id = v_owner_id;
end;
$$;
