-- Invite codes were drawn from md5(), so every code ever generated was hex:
-- 16 possible characters, and a real keyspace of 16^4 = 65,536 rather than the
-- ~1.7 million a 4-character alphanumeric code looks like it should have. That
-- was never a deliberate choice, it's just what md5() happens to emit, and it
-- makes guessing at codes 26x cheaper than the format implies. The rate limit
-- added in 20260813130000 is the real defence; this widens what it's defending.
--
-- The new alphabet is 32 characters: digits 2-9 and A-Z without I and O.
-- 0/O and 1/I are dropped because a code gets read out loud in a bar and typed
-- off a printed card, and those two pairs are exactly the ones that come back
-- as the wrong character. 32^4 = 1,048,576, a 16x jump, and the drop from 36
-- to 32 costs nothing that matters: the collision-retry loop below is what
-- guarantees uniqueness either way.
--
-- Existing codes are deliberately NOT rewritten, unlike the "BB-" prefix
-- removal. There is nothing to reconcile this time (a stored code is looked up
-- by exact match, and every old hex code is still valid A-Z0-9 that
-- normalizeInviteCode() and the four input boxes already accept), and rewriting
-- would kill every /join link and printed card already out in the world to buy
-- nothing but tidiness. Old codes simply keep working and may contain a 0 or a
-- 1; new ones never will.
--
-- Randomness comes from gen_random_uuid()'s CSPRNG rather than random(), which
-- is a per-session PRNG that was never the right source for something whose
-- whole job is being unguessable. Only bytes 0-3 are used: bytes 6 and 8 of a
-- v4 UUID carry fixed version/variant bits, so they aren't fully random. Taking
-- each byte modulo 32 is exactly uniform, since 256 divides evenly by 32 -- no
-- modulo bias to reason about. pgcrypto's gen_random_bytes() would be the more
-- direct tool, but it lives in the extensions schema and these functions run
-- with `search_path = public`; uuid_send()/get_byte()/gen_random_uuid() are all
-- pg_catalog builtins, so this needs no extension and no search_path change.
create or replace function _generate_invite_code()
returns citext
language plpgsql
security definer
set search_path = public
as $$
declare
  -- Keep this a power-of-two length: the modulo below is only unbiased because
  -- 256 divides evenly by it.
  v_alphabet constant text := '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  v_bytes bytea;
  v_invite_code text;
  v_i int;
begin
  loop
    v_bytes := uuid_send(gen_random_uuid());
    v_invite_code := '';
    for v_i in 0 .. 3 loop
      v_invite_code := v_invite_code || substr(v_alphabet, 1 + (get_byte(v_bytes, v_i) % length(v_alphabet)), 1);
    end loop;
    exit when not exists (select 1 from groups where invite_code = v_invite_code::citext);
  end loop;
  return v_invite_code::citext;
end;
$$;

revoke execute on function _generate_invite_code() from public;
revoke execute on function _generate_invite_code() from authenticated;
