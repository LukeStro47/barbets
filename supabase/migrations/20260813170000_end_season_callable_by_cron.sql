-- expire_stale() has called end_season() for every active season past its
-- ends_at since 20260719147000, and that call has never once succeeded.
-- end_season() opens with `v_caller uuid := auth.uid()` and then requires the
-- caller to be an active member of the group and its owner. Under pg_cron
-- there is no request JWT, so auth.uid() is NULL, `user_id = NULL` matches no
-- membership row, and the function raises `not_found: group not found`. It is
-- an owner-gated action being called by a robot that is nobody.
--
-- Two separate consequences, and the second is much the bigger one:
--
--   1. Timed seasons never auto-end. Any group whose season_length is
--      1m/2m/3m/custom gets a real seasons.ends_at (via
--      _compute_season_ends_at); 'manual' groups get NULL and are unaffected,
--      which is most likely why this has gone unnoticed. For everyone else the
--      owner has to end the season by hand and the ends_at date means nothing.
--   2. expire_stale() is one transaction over every group on the platform with
--      no per-row error handling, so that raise aborts the *whole* sweep for
--      *everyone*: market auto-close, auto-finalize, the wind-down sweeps,
--      scheduled group deletions, the retention cleanup, all rolled back. And
--      because nothing commits, the next tick re-selects the same season and
--      fails identically. A single group reaching its season end date wedges
--      the entire platform's background maintenance, permanently, and silently
--      (expire_stale has no error reporting; the failure lands in
--      cron.job_run_details, which nobody reads).
--
-- This migration fixes the reachability half. 20260813180000 fixes the
-- isolation half, which is what stops the next raise from doing (2) again.
-- Both are needed: isolation alone would leave timed seasons still not ending,
-- just quietly instead of catastrophically.
--
-- The fix is the usual split. The work moves into an internal _end_season()
-- that takes its actor as a parameter instead of asking auth.uid() for it, and
-- the client-facing end_season() becomes the authorization gate in front of
-- it. Cron passes NULL, which is already exactly what
-- _finalize_season(p_season_id, p_actor_id) expects for a season that ends
-- with no human behind it (see 20260719149000, where the actor param was added
-- for the same reason on the wind-down path).
--
-- Signature note, per the repeated overload trap: end_season(uuid) keeps its
-- exact signature, so CREATE OR REPLACE genuinely replaces it and no second
-- overload can appear. _end_season(uuid, uuid) is new, and nothing else in the
-- schema has that name.

-- The season-ending work itself, with no opinion about who is allowed to ask
-- for it. p_actor_id is attribution only (it reaches _finalize_season, which
-- records who ended the season); it is never used as an authorization input,
-- so passing NULL from cron is meaningful rather than a bypass.
create or replace function _end_season(p_group_id uuid, p_actor_id uuid default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_settings group_settings%rowtype;
  v_season seasons%rowtype;
  v_in_flight int;
  rec record;
begin
  select * into v_settings from group_settings where group_id = p_group_id;

  select * into v_season from seasons where group_id = p_group_id and status = 'active' for update;
  if v_season.id is null then
    raise exception 'invalid_operation: no active season to end';
  end if;

  for rec in
    select id from markets
    where season_id = v_season.id and status in ('pending_sponsor', 'open', 'closed')
    for update
  loop
    perform _void_market(rec.id);
  end loop;

  select count(*) into v_in_flight
  from markets
  where season_id = v_season.id and status in ('proposed', 'disputed');

  update seasons set ended_at = now() where id = v_season.id;

  if v_in_flight = 0 then
    perform _finalize_season(v_season.id, p_actor_id);
  else
    update seasons
    set status = 'winding_down', wind_down_deadline = now() + (v_settings.resolution_window_hours * interval '1 hour')
    where id = v_season.id;
  end if;
end;
$$;

revoke execute on function _end_season(uuid, uuid) from public;
revoke execute on function _end_season(uuid, uuid) from authenticated;

-- The client-facing entry point: unchanged behaviour, unchanged error strings,
-- now nothing but the gate plus a delegation. The membership check stays a
-- not_found rather than a forbidden, per the 404-never-403 rule: a non-member
-- must not be able to tell an existing group from one that isn't there. The
-- owner check below is a genuine forbidden, which is fine and predates this
-- migration: by that point the caller has already proved they can see the
-- group, so there is nothing left to conceal.
create or replace function end_season(p_group_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_group groups%rowtype;
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
    raise exception 'forbidden: only the group owner can end the season';
  end if;

  perform _end_season(p_group_id, v_caller);
end;
$$;

revoke execute on function end_season(uuid) from public;
grant execute on function end_season(uuid) to authenticated;
