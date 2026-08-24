-- Bug fix: create_public_group()'s RETURNS TABLE(id, name, owner_id, ...) implicitly declares a
-- PL/pgSQL variable for every one of those column names, including `name` — which collided with
-- `pg_timezone_names.name` in the timezone-validity check, raising "column reference "name" is
-- ambiguous" on every call. Every other function with that identical check (create_group,
-- update_group_settings) is unaffected, since none of them happen to have an OUT parameter also
-- called `name`. Fix: qualify it. Same signature, plain CREATE OR REPLACE.
create or replace function create_public_group(
  p_name text,
  p_category text,
  p_seed_amount int,
  p_timezone text default 'UTC',
  p_nickname text default null,
  p_moderator_emails text[] default '{}'
) returns table (
  id uuid,
  name text,
  owner_id uuid,
  invite_code citext,
  created_at timestamptz,
  deletion_scheduled_at timestamptz,
  avatar_key text,
  is_public boolean,
  category text,
  unresolved_emails text[]
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_group groups%rowtype;
  v_membership_id uuid;
  v_name text;
  v_nickname citext;
  v_email text;
  v_target_id uuid;
  v_base_nickname citext;
  v_candidate citext;
  v_suffix int;
  v_unresolved text[] := '{}';
begin
  if not is_platform_admin(v_user_id) then
    raise exception 'forbidden: admin only';
  end if;

  v_name := nullif(trim(p_name), '');
  if v_name is null then
    raise exception 'invalid_operation: group name can''t be blank';
  end if;
  if length(v_name) > 60 then
    raise exception 'invalid_operation: group name must be 60 characters or fewer';
  end if;

  if p_category not in ('generic', 'campus') then
    raise exception 'invalid_operation: category must be generic or campus';
  end if;

  if p_seed_amount is null or p_seed_amount < 1 or p_seed_amount > 1000000 then
    raise exception 'invalid_operation: the token allocation must be between 1 and 1,000,000';
  end if;

  if not exists (select 1 from pg_timezone_names where pg_timezone_names.name = p_timezone) then
    raise exception 'invalid_operation: unrecognized time zone';
  end if;

  insert into groups (name, owner_id, invite_code, is_public, category)
  values (v_name, v_user_id, _generate_invite_code(), true, p_category)
  returning * into v_group;

  -- Every hard-rule flag set explicitly here, not left to a column default: a public group must
  -- never momentarily exist without the rules that define it (see 20260825100000's coercion in
  -- update_group_settings, which corrects these if this insert is ever wrong again).
  insert into group_settings (
    group_id, seed_amount, seasons_enabled, timezone, betting_enabled, accepting_members,
    allow_hedged_bets, require_endorsement, awards_enabled
  )
  values (v_group.id, p_seed_amount, false, p_timezone, true, true, false, false, false);

  if p_nickname is not null and trim(p_nickname) <> '' then
    v_nickname := lower(trim(p_nickname))::citext;
    if v_nickname::text !~ '^[a-z0-9_]{1,20}$' then
      raise exception 'invalid_operation: nicknames can only use lowercase letters, numbers, and underscores, up to 20 characters';
    end if;
    if _nickname_contains_blocked_word(v_nickname::text) then
      raise exception 'invalid_operation: that nickname isn''t allowed, try a different one';
    end if;

    insert into memberships (group_id, user_id, balance, status, nickname, role)
    values (v_group.id, v_user_id, p_seed_amount, 'active', v_nickname, 'moderator')
    returning memberships.id into v_membership_id;

    insert into ledger (membership_id, amount, reason)
    values (v_membership_id, p_seed_amount, 'seed');
  end if;

  if p_moderator_emails is not null then
    foreach v_email in array p_moderator_emails loop
      v_email := nullif(trim(v_email), '');
      continue when v_email is null;

      select au.id into v_target_id from auth.users au where lower(au.email) = lower(v_email);
      if v_target_id is null then
        v_unresolved := v_unresolved || v_email;
        continue;
      end if;

      -- Already handled above (the admin invited themselves), or already added by an earlier
      -- duplicate in the same list — either way, nothing new to do.
      perform 1 from memberships where group_id = v_group.id and user_id = v_target_id;
      if found then
        continue;
      end if;

      v_base_nickname := lower(regexp_replace(split_part(v_email, '@', 1), '[^a-zA-Z0-9_]', '', 'g'));
      if v_base_nickname::text = '' or _nickname_contains_blocked_word(v_base_nickname::text) then
        v_base_nickname := 'mod';
      end if;
      v_base_nickname := left(v_base_nickname::text, 16)::citext;

      v_candidate := v_base_nickname;
      v_suffix := 1;
      while exists (
        select 1 from memberships where group_id = v_group.id and nickname = v_candidate and status not in ('removed', 'left')
      ) loop
        v_suffix := v_suffix + 1;
        v_candidate := (left(v_base_nickname::text, 16) || v_suffix::text)::citext;
      end loop;

      insert into memberships (group_id, user_id, balance, status, nickname, role)
      values (v_group.id, v_target_id, p_seed_amount, 'active', v_candidate, 'moderator')
      returning memberships.id into v_membership_id;

      insert into ledger (membership_id, amount, reason)
      values (v_membership_id, p_seed_amount, 'seed');

      perform _emit_notification_event('assigned_group_moderator', v_group.id, null, null, v_target_id);
    end loop;
  end if;

  return query select
    v_group.id, v_group.name, v_group.owner_id, v_group.invite_code, v_group.created_at,
    v_group.deletion_scheduled_at, v_group.avatar_key, v_group.is_public, v_group.category,
    v_unresolved;
end;
$$;

revoke execute on function create_public_group(text, text, int, text, text, text[]) from public;
grant execute on function create_public_group(text, text, int, text, text, text[]) to authenticated;
