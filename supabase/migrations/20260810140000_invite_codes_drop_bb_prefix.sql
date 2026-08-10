-- Invite codes lose their literal "BB-" prefix. It was branding on a string
-- people have to read out loud in a bar, and it cost four of the characters
-- in every "what's the code?" exchange while carrying zero information (every
-- code had it, so it never distinguished anything).
--
-- Existing codes are rewritten in place rather than left on the old format:
-- two live formats would mean every input, every paste handler, and every
-- support conversation has to know about both indefinitely. The rewrite can't
-- collide, since the prefix was uniform across every row, so the 4-character
-- suffixes were already unique among themselves.
--
-- Links already shared as /join/BB-XXXX keep working: lib/inviteCode.ts's
-- normalizeInviteCode() strips a legacy prefix on the way in, at the one place
-- every join path already funnels through, so no Postgres function needs a
-- second lookup form.
update groups set invite_code = substr(invite_code::text, 4) where invite_code::text ilike 'BB-%';

-- The shared collision-retry generator (create_group / regenerate_invite_code
-- / remove_member's rotation all call this one function).
create or replace function _generate_invite_code()
returns citext
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite_code citext;
begin
  loop
    v_invite_code := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 4));
    exit when not exists (select 1 from groups where invite_code = v_invite_code);
  end loop;
  return v_invite_code;
end;
$$;

revoke execute on function _generate_invite_code() from public;
revoke execute on function _generate_invite_code() from authenticated;
