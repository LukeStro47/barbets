-- Native push (Capacitor/FCM) rows live in the same table as Web Push rows, distinguished by
-- `platform`. Web rows keep the existing endpoint/p256dh/auth_key shape; native rows carry an
-- fcm_token instead - exactly one of the two shapes populated per row, same XOR-by-CHECK pattern
-- used elsewhere in this schema (see ARCHITECTURE.md's bet_side/option_id notes).
alter table push_subscriptions
  add column platform text not null default 'web',
  add column fcm_token text;

alter table push_subscriptions
  alter column endpoint drop not null,
  alter column p256dh drop not null,
  alter column auth_key drop not null;

alter table push_subscriptions
  add constraint push_subscriptions_platform_check check (platform in ('web', 'android', 'ios'));

alter table push_subscriptions
  add constraint push_subscriptions_shape_check check (
    (platform = 'web' and endpoint is not null and p256dh is not null and auth_key is not null and fcm_token is null)
    or
    (platform in ('android', 'ios') and fcm_token is not null and endpoint is null and p256dh is null and auth_key is null)
  );

-- Mirrors the existing unique(user_id, endpoint): a plain (non-partial) unique constraint already
-- allows unlimited rows with a null fcm_token per user (every web row), same as endpoint already
-- does for native rows - no partial index needed, and ON CONFLICT (user_id, fcm_token) can infer
-- this directly.
alter table push_subscriptions add constraint push_subscriptions_user_fcm_token_unique unique (user_id, fcm_token);
