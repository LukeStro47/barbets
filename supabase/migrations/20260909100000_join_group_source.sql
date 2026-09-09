-- join_group gains a third parameter, p_join_source, so the group_join row it writes to
-- lifecycle_events can say how the invite arrived: 'qr' (the group hub's on-screen QR code,
-- scanned), 'code' (typed into the four boxes), or 'link' (a bare /join/<code> URL). The client
-- reads it off the join URL's ?src= and passes it straight through lib/actions/groups.ts's
-- joinGroup(); anything that isn't one of those three exact values is stored as null rather
-- than raising, since a bad tag is never a reason to refuse a join.
--
-- Signature change, so the old overload is dropped first: `create or replace` with a new
-- trailing parameter would leave join_group(text, citext) AND join_group(text, citext, text)
-- both live, and PostgREST can't pick between them for a call that omits the new argument
-- (see the overload note in ARCHITECTURE.md). Every existing call site omits it today.
--
-- Body redeclared verbatim from 20260829130000_lifecycle_event_instrumentation.sql. The only
-- changes: the new parameter, the v_source declaration/normalization at the top, and `metadata`
-- on the two lifecycle_events inserts. Every gate, raise, insert, and the zero-rows miss path
-- are unchanged; the dormant/left rejoin branches still record no lifecycle row (a rejoin is not
-- a first join).

drop function if exists join_group(text, citext);

create function join_group(p_invite_code text, p_nickname citext default null, p_join_source text default null)
returns setof memberships
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_group groups%rowtype;
  v_settings group_settings%rowtype;
  v_active_season seasons%rowtype;
  v_intermission_season seasons%rowtype;
  v_membership memberships%rowtype;
  v_seed int;
  v_source text := case when p_join_source in ('qr', 'code', 'link') then p_join_source else null end;
begin
  perform _enforce_invite_code_rate_limit();

  select * into v_group from groups where invite_code = p_invite_code::citext;
  if v_group.id is null then
    -- Records and returns nothing rather than raising: a RAISE would abort the
    -- transaction and take the counter write with it.
    perform _record_invite_code_miss();
    return;
  end if;

  select * into v_membership from memberships where group_id = v_group.id and user_id = v_user_id;
  if v_membership.id is not null then
    if v_membership.status = 'removed' then
      raise exception 'forbidden: you can''t rejoin this group';
    end if;

    if v_membership.status = 'dormant' then
      update memberships set status = 'active' where id = v_membership.id returning * into v_membership;
      return next v_membership;
      return;
    end if;

    if v_membership.status = 'left' then
      if p_nickname is null or trim(p_nickname::text) = '' then
        raise exception 'invalid_operation: choose a nickname to join with';
      end if;
      if p_nickname::text !~ '^[A-Za-z0-9_]{1,20}$' then
        raise exception 'invalid_operation: nicknames can only use letters, numbers, and underscores, up to 20 characters';
      end if;
      perform 1 from memberships where group_id = v_group.id and nickname = p_nickname and status not in ('removed', 'left');
      if found then
        raise exception 'invalid_operation: that nickname is already taken in this group';
      end if;

      update memberships set status = 'active', nickname = p_nickname where id = v_membership.id returning * into v_membership;
      return next v_membership;
      return;
    end if;

    return next v_membership;
    return;
  end if;

  -- Only a genuinely new membership reaches here.
  if v_group.deletion_scheduled_at is not null then
    raise exception 'invalid_operation: this group is scheduled for deletion and isn''t taking new members';
  end if;

  select * into v_settings from group_settings where group_id = v_group.id;
  if not v_settings.accepting_members then
    raise exception 'invalid_operation: this group isn''t accepting new members right now';
  end if;

  if p_nickname is null or trim(p_nickname::text) = '' then
    raise exception 'invalid_operation: choose a nickname to join with';
  end if;
  if p_nickname::text !~ '^[A-Za-z0-9_]{1,20}$' then
    raise exception 'invalid_operation: nicknames can only use letters, numbers, and underscores, up to 20 characters';
  end if;
  perform 1 from memberships where group_id = v_group.id and nickname = p_nickname and status not in ('removed', 'left');
  if found then
    raise exception 'invalid_operation: that nickname is already taken in this group';
  end if;

  if v_settings.seasons_enabled then
    select * into v_active_season from seasons where group_id = v_group.id and status = 'active';
  end if;

  if v_settings.seasons_enabled and v_active_season.id is null then
    select * into v_intermission_season from seasons where group_id = v_group.id and status = 'intermission';

    insert into memberships (group_id, user_id, balance, status, nickname)
    values (v_group.id, v_user_id, 0, 'dormant', p_nickname)
    returning * into v_membership;

    if v_intermission_season.id is not null then
      insert into season_optins (season_id, user_id)
      values (v_intermission_season.id, v_user_id)
      on conflict do nothing;
    end if;

    perform _emit_notification_event('member_joined', v_group.id, null, null, v_user_id);
    insert into lifecycle_events (event_type, user_id, group_id, metadata)
    values ('group_join', v_user_id, v_group.id, jsonb_build_object('source', v_source));

    return next v_membership;
    return;
  end if;

  v_seed := case when v_settings.seasons_enabled then v_active_season.seed_amount else v_settings.seed_amount end;

  insert into memberships (group_id, user_id, balance, status, nickname)
  values (v_group.id, v_user_id, v_seed, 'active', p_nickname)
  returning * into v_membership;

  insert into ledger (membership_id, amount, reason)
  values (v_membership.id, v_seed, 'seed');

  perform _emit_notification_event('member_joined', v_group.id, null, null, v_user_id);
  insert into lifecycle_events (event_type, user_id, group_id, metadata)
  values ('group_join', v_user_id, v_group.id, jsonb_build_object('source', v_source));

  return next v_membership;
  return;
end;
$$;

revoke execute on function join_group(text, citext, text) from public;
grant execute on function join_group(text, citext, text) to authenticated;
-- Supabase's bootstrap grants anon EXECUTE on every new function directly, and revoking from
-- PUBLIC does not touch that grant (see the anon-grant note in ARCHITECTURE.md). join_group
-- was one of the two functions 20260814120000 originally closed this hole on; the drop above
-- takes that revoke with it, so it is restated here.
revoke execute on function join_group(text, citext, text) from anon;
