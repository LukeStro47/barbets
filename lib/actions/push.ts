'use server';

import { createClient } from '@/lib/supabase/server';
import type { ActionResult } from '@/lib/errors';

export async function savePushSubscription(subscription: { endpoint: string; keys: { p256dh: string; auth: string } }): Promise<ActionResult<null>> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 'Not signed in.' };

  const { error } = await supabase.rpc('save_push_subscription', {
    p_endpoint: subscription.endpoint,
    p_p256dh: subscription.keys.p256dh,
    p_auth_key: subscription.keys.auth,
  });
  if (error) return { error: error.message };
  return { data: null };
}

export async function removePushSubscription(endpoint: string): Promise<ActionResult<null>> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 'Not signed in.' };

  const { error } = await supabase.from('push_subscriptions').delete().eq('user_id', user.id).eq('endpoint', endpoint);
  if (error) return { error: error.message };
  return { data: null };
}

/** The Capacitor-native counterpart of savePushSubscription — one FCM token per device instead of
 * a Web Push endpoint/keys triple. See 20260722100000_native_push_tokens.sql. */
export async function saveNativePushSubscription(fcmToken: string, platform: 'android' | 'ios'): Promise<ActionResult<null>> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 'Not signed in.' };

  const { error } = await supabase.rpc('save_native_push_subscription', { p_fcm_token: fcmToken, p_platform: platform });
  if (error) return { error: error.message };
  return { data: null };
}

export async function removeNativePushSubscription(fcmToken: string): Promise<ActionResult<null>> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 'Not signed in.' };

  const { error } = await supabase.from('push_subscriptions').delete().eq('user_id', user.id).eq('fcm_token', fcmToken);
  if (error) return { error: error.message };
  return { data: null };
}
