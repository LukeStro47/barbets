-- push_subscriptions is only unique per (user_id, endpoint) / (user_id, fcm_token), not per
-- endpoint/token alone -- deliberately, since a plain client-side upsert into a user's own rows
-- is exempt from this project's SECURITY DEFINER rule (see the original migration's comment).
-- But a Web Push endpoint or an FCM token identifies one browser/device, not one Barbets account:
-- if a second account ever subscribes from the same physical device an earlier account already
-- subscribed from and neither unsubscribes, both rows persist indefinitely, and any push correctly
-- addressed to either account's user_id lands on that one shared device regardless of which
-- account it was actually meant for. Found in production: a real member's push for their own
-- group also arrived on a second, unrelated account that had registered the same FCM token from
-- the same phone months earlier and never cleared it.
--
-- Deleting another user's row requires SECURITY DEFINER (RLS's push_subscriptions_all_own policy
-- only lets a user touch their own rows), so this is a new choke point for the "save" side rather
-- than a change to the existing policy: whoever most recently proves they hold this exact
-- endpoint/token (by presenting it, which only the device itself can produce) claims it, and
-- whichever other account's row was still pointing at that same endpoint/token is removed so it
-- stops receiving that device's pushes.
create or replace function save_push_subscription(p_endpoint text, p_p256dh text, p_auth_key text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'not_found: not signed in';
  end if;

  delete from push_subscriptions where endpoint = p_endpoint and user_id <> v_user_id;

  insert into push_subscriptions (user_id, endpoint, p256dh, auth_key)
  values (v_user_id, p_endpoint, p_p256dh, p_auth_key)
  on conflict (user_id, endpoint) do update set p256dh = excluded.p256dh, auth_key = excluded.auth_key;
end;
$$;

revoke execute on function save_push_subscription(text, text, text) from public;
grant execute on function save_push_subscription(text, text, text) to authenticated;

-- Native counterpart of save_push_subscription, same reasoning: an FCM token is tied to one app
-- install, not one Barbets account.
create or replace function save_native_push_subscription(p_fcm_token text, p_platform text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'not_found: not signed in';
  end if;

  if p_platform not in ('android', 'ios') then
    raise exception 'invalid_operation: platform must be android or ios';
  end if;

  delete from push_subscriptions where fcm_token = p_fcm_token and user_id <> v_user_id;

  insert into push_subscriptions (user_id, platform, fcm_token)
  values (v_user_id, p_platform, p_fcm_token)
  on conflict (user_id, fcm_token) do update set platform = excluded.platform;
end;
$$;

revoke execute on function save_native_push_subscription(text, text) from public;
grant execute on function save_native_push_subscription(text, text) to authenticated;
