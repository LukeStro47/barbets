// Drains notification_events (written by the Postgres functions themselves
// — see 20260707192239_notification_events.sql — so this covers both
// human-triggered and cron-triggered transitions equally) and sends real
// push notifications: Web Push for browser/PWA subscribers, FCM for the
// Capacitor native app (see 20260722100000_native_push_tokens.sql for the
// platform split in push_subscriptions). Invoked on a schedule; see the
// README for how it's wired up (pg_cron + pg_net, since Supabase's
// scheduled-function support and pg_cron availability both vary by project).
import webpush from 'npm:web-push@3.6.7';
import { createClient } from 'npm:@supabase/supabase-js@2';

const VAPID_PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY')!;
const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY')!;
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

webpush.setVapidDetails('mailto:barbets-app@example.com', VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

// Capacitor/FCM (Android and, once its APNs key is uploaded to Firebase, iOS) - a separate secret
// from the VAPID pair above since it's a whole different push service. Optional: a project that
// hasn't set this up yet just skips native sends instead of failing every event.
const FCM_SERVICE_ACCOUNT_JSON = Deno.env.get('FCM_SERVICE_ACCOUNT_JSON');
const fcmServiceAccount: { client_email: string; private_key: string; project_id: string } | null = FCM_SERVICE_ACCOUNT_JSON
  ? JSON.parse(FCM_SERVICE_ACCOUNT_JSON)
  : null;

let cachedFcmAccessToken: { token: string; expiresAt: number } | null = null;

function base64url(input: string | Uint8Array): string {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// FCM's HTTP v1 API takes a Google OAuth2 access token, not a static server key (the legacy "server
// key" approach was deprecated) - minted here from the service account's private key via a signed
// JWT, using Deno's native Web Crypto instead of pulling in a JWT library for one call.
async function getFcmAccessToken(): Promise<string> {
  if (!fcmServiceAccount) throw new Error('FCM not configured');
  const now = Math.floor(Date.now() / 1000);
  if (cachedFcmAccessToken && cachedFcmAccessToken.expiresAt > now + 60) return cachedFcmAccessToken.token;

  const claim = {
    iss: fcmServiceAccount.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  };
  const unsigned = `${base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${base64url(JSON.stringify(claim))}`;

  const pemBody = fcmServiceAccount.private_key.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s+/g, '');
  const keyBytes = Uint8Array.from(atob(pemBody), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', keyBytes, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned));
  const jwt = `${unsigned}.${base64url(new Uint8Array(signature))}`;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }),
  });
  if (!res.ok) throw new Error(`FCM token exchange failed: ${await res.text()}`);
  const data = await res.json();
  cachedFcmAccessToken = { token: data.access_token, expiresAt: now + data.expires_in };
  return data.access_token;
}

/** Same { title, body, url } shape the web push path already sends, so sw.js's notificationclick
 * handler and NativePushNavigation.tsx's notificationActionPerformed listener agree on where a tap
 * should land regardless of which channel actually delivered it. */
async function sendFcm(fcmToken: string, content: Content): Promise<{ ok: boolean; tokenInvalid: boolean }> {
  if (!fcmServiceAccount) return { ok: false, tokenInvalid: false };
  const accessToken = await getFcmAccessToken();
  const res = await fetch(`https://fcm.googleapis.com/v1/projects/${fcmServiceAccount.project_id}/messages:send`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: {
        token: fcmToken,
        notification: { title: content.title, body: content.body },
        data: { url: content.url },
      },
    }),
  });
  if (res.ok) return { ok: true, tokenInvalid: false };
  const errBody = await res.json().catch(() => null);
  const status = errBody?.error?.status;
  // UNREGISTERED/NOT_FOUND = the token is dead (app uninstalled, token rotated), same cleanup
  // reasoning as the 404/410 branch for Web Push subscriptions below.
  return { ok: false, tokenInvalid: status === 'UNREGISTERED' || status === 'NOT_FOUND' };
}

interface NotificationEvent {
  id: string;
  event_type: string;
  group_id: string;
  market_id: string | null;
  season_id: string | null;
  actor_id: string | null;
}

interface Content {
  title: string;
  body: string;
  url: string;
}

async function marketAndGroup(marketId: string) {
  const { data: market } = await admin.from('markets').select('title, group_id, market_type').eq('id', marketId).single();
  const { data: group } = await admin.from('groups').select('name').eq('id', market!.group_id).single();
  return { market: market!, group: group! };
}

async function buildContent(event: NotificationEvent, isSubject: boolean): Promise<Content | null> {
  if (event.event_type === 'season_ended') {
    const { data: season } = await admin.from('seasons').select('number').eq('id', event.season_id).single();
    const { data: group } = await admin.from('groups').select('name').eq('id', event.group_id).single();
    return {
      title: group!.name,
      body: `Season ${season!.number} is over. Run it back?`,
      url: `/groups/${event.group_id}/intermission`,
    };
  }

  if (event.event_type === 'betting_opened') {
    const { data: group } = await admin.from('groups').select('name').eq('id', event.group_id).single();
    return {
      title: group!.name,
      body: 'Betting is open. Time to start a market.',
      url: `/groups/${event.group_id}`,
    };
  }

  if (event.event_type === 'member_joined') {
    const { data: group } = await admin.from('groups').select('name').eq('id', event.group_id).single();
    const { data: member } = await admin.from('memberships').select('nickname').eq('group_id', event.group_id).eq('user_id', event.actor_id).single();
    return {
      title: group!.name,
      body: member ? `@${member.nickname} just joined your group.` : 'Someone just joined your group.',
      url: `/groups/${event.group_id}/settings`,
    };
  }

  if (event.event_type === 'group_deletion_scheduled') {
    const { data: group } = await admin.from('groups').select('name').eq('id', event.group_id).single();
    return {
      title: group!.name,
      body: `The owner deleted ${group!.name}. Every open market was refunded, and the group itself is gone for good in 5 days unless they undo it.`,
      url: `/groups/${event.group_id}/settings`,
    };
  }

  if (event.event_type === 'group_deletion_canceled') {
    const { data: group } = await admin.from('groups').select('name').eq('id', event.group_id).single();
    return {
      title: group!.name,
      body: `False alarm, the owner canceled the deletion of ${group!.name}.`,
      url: `/groups/${event.group_id}`,
    };
  }

  if (event.event_type === 'season_betting_opened') {
    const { data: group } = await admin.from('groups').select('name').eq('id', event.group_id).single();
    return {
      title: group!.name,
      body: 'Betting is open for this season. Time to start a market.',
      url: `/groups/${event.group_id}`,
    };
  }

  if (event.event_type === 'group_deletion_scheduled_inactivity') {
    const { data: group } = await admin.from('groups').select('name').eq('id', event.group_id).single();
    return {
      title: group!.name,
      body: `Nobody's started a new season in ${group!.name} for 30 days, so it'll be deleted for good in 5 days unless someone continues it.`,
      url: `/groups/${event.group_id}/intermission`,
    };
  }

  if (event.event_type === 'group_titles_updated') {
    const { data: group } = await admin.from('groups').select('name').eq('id', event.group_id).single();
    return {
      title: group!.name,
      body: 'The Awards just shuffled. See who holds what now.',
      url: `/groups/${event.group_id}/awards`,
    };
  }

  if (!event.market_id) return null;
  const { market, group } = await marketAndGroup(event.market_id);
  const url = `/groups/${event.group_id}/markets/${event.market_id}`;
  const revealUrl = `${url}/reveal`;

  switch (event.event_type) {
    case 'market_needs_endorsement':
      return { title: group.name, body: 'New market needs endorsement', url };
    case 'market_opened':
      return { title: group.name, body: `New market opened: "${market.title}"`, url };
    case 'market_closed':
      return { title: group.name, body: `Odds are live: "${market.title}"`, url };
    case 'resolution_proposed':
      return { title: group.name, body: `A resolution was proposed: "${market.title}"`, url };
    case 'resolution_challenged':
      return { title: group.name, body: `A challenge has been raised: "${market.title}"`, url };
    case 'market_resolved':
      return isSubject
        ? { title: group.name, body: 'A market about you has just resolved...', url: revealUrl }
        : { title: group.name, body: `A market has resolved: "${market.title}"`, url: revealUrl };
    case 'market_voided':
      return { title: group.name, body: `The owner voided a market and refunded everyone: "${market.title}"`, url: revealUrl };
    case 'clarification_requested': {
      const { data: latest } = await admin
        .from('resolution_clarifications')
        .select('requester_id')
        .eq('market_id', event.market_id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      const { data: requester } = latest
        ? await admin.from('memberships').select('nickname').eq('group_id', event.group_id).eq('user_id', latest.requester_id).maybeSingle()
        : { data: null };
      return {
        title: group.name,
        body: requester
          ? `@${requester.nickname} asked for clearer resolution criteria on "${market.title}"`
          : `Someone asked for clearer resolution criteria on "${market.title}"`,
        url,
      };
    }
    case 'criteria_updated':
      return { title: group.name, body: `Resolution criteria updated: "${market.title}"`, url };
    case 'impressive_bet': {
      const { data: bet } = await admin
        .from('bets')
        .select('amount, payout')
        .eq('market_id', event.market_id)
        .eq('user_id', event.actor_id)
        .not('settled_at', 'is', null)
        .order('payout', { ascending: false })
        .limit(1)
        .maybeSingle();
      const multiple = bet ? (bet.payout / bet.amount).toFixed(1) : null;
      return {
        title: group.name,
        body: multiple
          ? `You just pulled off the biggest underdog win in ${group.name}'s history, ${multiple}x on "${market.title}"!`
          : `You just pulled off the biggest underdog win in ${group.name}'s history on "${market.title}"!`,
        url: revealUrl,
      };
    }
    default:
      return null;
  }
}

async function sendToUser(userId: string, content: Content) {
  const { data: subs } = await admin
    .from('push_subscriptions')
    .select('id, platform, endpoint, p256dh, auth_key, fcm_token')
    .eq('user_id', userId);

  for (const sub of subs ?? []) {
    if (sub.platform === 'web') {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth_key } },
          JSON.stringify(content)
        );
      } catch (err: any) {
        // 404/410 = the subscription is dead (browser unsubscribed, uninstalled, etc.) — clean it up.
        if (err?.statusCode === 404 || err?.statusCode === 410) {
          await admin.from('push_subscriptions').delete().eq('id', sub.id);
        } else {
          console.error('push send failed', userId, err?.message ?? err);
        }
      }
      continue;
    }

    try {
      const { ok, tokenInvalid } = await sendFcm(sub.fcm_token, content);
      if (!ok && tokenInvalid) {
        await admin.from('push_subscriptions').delete().eq('id', sub.id);
      } else if (!ok) {
        console.error('fcm send failed', userId, sub.id);
      }
    } catch (err) {
      console.error('fcm send failed', userId, err instanceof Error ? err.message : err);
    }
  }
}

async function processEvent(event: NotificationEvent) {
  const { data: recipients } = await admin.rpc('get_event_recipients', { p_event_id: event.id });
  const recipientIds: string[] = (recipients ?? []).map((r: { user_id: string }) => r.user_id);
  if (recipientIds.length === 0) return;

  let subjectIds = new Set<string>();
  if (event.event_type === 'market_resolved' && event.market_id) {
    const { data: subjects } = await admin.from('market_subjects').select('user_id').eq('market_id', event.market_id);
    subjectIds = new Set((subjects ?? []).map((s: { user_id: string }) => s.user_id));
  }

  // market_resolved needs different copy for subjects vs everyone else;
  // every other event type sends the same content to its whole recipient list.
  const nonSubjectContent = await buildContent(event, false);
  const subjectContent = subjectIds.size > 0 ? await buildContent(event, true) : null;

  for (const userId of recipientIds) {
    const content = subjectIds.has(userId) ? subjectContent : nonSubjectContent;
    if (content) await sendToUser(userId, content);
  }
}

Deno.serve(async (req) => {
  const { data: events, error } = await admin
    .from('notification_events')
    .select('*')
    .is('processed_at', null)
    .order('created_at', { ascending: true })
    .limit(50);

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }

  let processed = 0;
  for (const event of (events ?? []) as NotificationEvent[]) {
    try {
      await processEvent(event);
    } catch (err) {
      console.error('event processing failed', event.id, err);
    }
    // Marked processed after an attempt regardless of per-recipient send
    // failures (those are logged, not retried) — an event that crashed
    // before this point stays unprocessed and is picked up next run.
    await admin.from('notification_events').update({ processed_at: new Date().toISOString() }).eq('id', event.id);
    processed++;
  }

  return new Response(JSON.stringify({ processed }), { headers: { 'Content-Type': 'application/json' } });
});
