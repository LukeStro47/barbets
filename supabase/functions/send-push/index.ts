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
//
// Stored base64-encoded (FCM_SERVICE_ACCOUNT_JSON_B64), not as raw JSON: `supabase secrets set`
// takes its value straight from a shell argument, and a Google service account key is nothing but
// double-quote characters and embedded newlines — exactly what shell argument quoting mangles
// first. Base64's alphabet (A-Za-z0-9+/=) can't collide with any shell metacharacter, so this class
// of bug can't recur. Parsing is wrapped in try/catch, not just the base64 decode: this is
// top-level module code, and this exact secret being silently malformed once already crashed the
// whole function on every cold start — every push, web included, not just FCM — since a module
// that throws during initialization never reaches Deno.serve() at all.
const FCM_SERVICE_ACCOUNT_JSON_B64 = Deno.env.get('FCM_SERVICE_ACCOUNT_JSON_B64');
let fcmServiceAccount: { client_email: string; private_key: string; project_id: string } | null = null;
try {
  if (FCM_SERVICE_ACCOUNT_JSON_B64) fcmServiceAccount = JSON.parse(atob(FCM_SERVICE_ACCOUNT_JSON_B64));
} catch (err) {
  console.error('FCM_SERVICE_ACCOUNT_JSON_B64 is set but not valid base64-encoded JSON - native push disabled', err);
}

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
  custom_title: string | null;
  custom_body: string | null;
}

interface Content {
  title: string;
  body: string;
  url: string;
}

async function marketAndGroup(marketId: string) {
  const { data: market } = await admin
    .from('markets')
    .select('title, group_id, market_type, outcome, outcome_option_id')
    .eq('id', marketId)
    .single();
  const { data: group } = await admin.from('groups').select('name').eq('id', market!.group_id).single();
  return { market: market!, group: group! };
}

/** A short, human "what happened" phrase for a resolved market's push copy, e.g. "YES" or a
    multiple_choice option's own label. VOID reads as "voided" rather than the literal enum value. */
async function marketOutcomeLabel(market: { outcome: string | null; outcome_option_id: string | null; market_type: string }): Promise<string> {
  if (market.outcome === 'void') return 'voided';
  if (market.market_type === 'multiple_choice' && market.outcome_option_id) {
    const { data: option } = await admin.from('market_options').select('label').eq('id', market.outcome_option_id).single();
    return option?.label ?? 'resolved';
  }
  return market.outcome ? market.outcome.toUpperCase() : 'resolved';
}

async function resolutionWindowLabel(groupId: string): Promise<string> {
  const { data: settings } = await admin.from('group_settings').select('resolution_window_hours').eq('group_id', groupId).single();
  const hours = settings?.resolution_window_hours ?? 8;
  return hours === 1 ? '1 hour' : `${hours} hours`;
}

async function buildContent(event: NotificationEvent, isSubject: boolean, winnings?: number | null, staked?: number | null): Promise<Content | null> {
  if (event.event_type === 'season_ended') {
    const { data: season } = await admin.from('seasons').select('number').eq('id', event.season_id).single();
    const { data: group } = await admin.from('groups').select('name').eq('id', event.group_id).single();
    return {
      title: group!.name,
      body: `Season ${season!.number} just wrapped up. Check the final standings and start the next one when you're ready.`,
      url: `/groups/${event.group_id}/intermission`,
    };
  }

  if (event.event_type === 'betting_opened') {
    const { data: group } = await admin.from('groups').select('name').eq('id', event.group_id).single();
    return {
      title: group!.name,
      body: 'Betting just opened. Be the first to start a market.',
      url: `/groups/${event.group_id}`,
    };
  }

  if (event.event_type === 'member_joined') {
    const { data: group } = await admin.from('groups').select('name').eq('id', event.group_id).single();
    const { data: member } = await admin.from('memberships').select('nickname').eq('group_id', event.group_id).eq('user_id', event.actor_id).single();
    return {
      title: group!.name,
      body: member
        ? `@${member.nickname} just joined ${group!.name}. Say hi, or get a market going.`
        : `Someone just joined ${group!.name}.`,
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
      body: 'Betting just opened for the season. Time to start a market.',
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

  // The Friday-midday prompt. Group-scoped with no market behind it (the sweep only
  // fires it for groups with nothing open), so it deep-links straight to the create form
  // rather than to a group page that has nothing on it worth landing on.
  if (event.event_type === 'weekend_nudge') {
    const { data: group } = await admin.from('groups').select('name').eq('id', event.group_id).single();
    return {
      title: group!.name,
      body: "Weekend's nearly here. Anyone up to something worth betting on?",
      url: `/groups/${event.group_id}/markets/new`,
    };
  }

  if (event.event_type === 'admin_broadcast') {
    return {
      title: event.custom_title!,
      body: event.custom_body!,
      url: `/groups/${event.group_id}`,
    };
  }

  if (!event.market_id) return null;
  const { market, group } = await marketAndGroup(event.market_id);
  const url = `/groups/${event.group_id}/markets/${event.market_id}`;
  const revealUrl = `${url}/reveal`;

  switch (event.event_type) {
    case 'market_needs_endorsement':
      return { title: group.name, body: `A new market needs an endorser before it can open: "${market.title}"`, url };
    case 'market_opened':
      return { title: group.name, body: `Betting's open on a new market: "${market.title}"`, url };
    case 'market_opened_about_you':
      return { title: group.name, body: `A new market just opened about you. No spoilers, but you can watch the action.`, url };
    case 'market_closed':
      return { title: group.name, body: `Betting just closed, odds are live: "${market.title}"`, url };
    // Only ever sent to someone who hasn't bet in this group for a week (that filtering
    // happens in get_event_recipients), so the copy can lean on it.
    case 'market_closing_soon':
      return { title: group.name, body: `Betting closes in 2 hours on "${market.title}". It's been a minute since your last one.`, url };
    case 'resolution_proposed': {
      const windowLabel = await resolutionWindowLabel(event.group_id);
      return {
        title: group.name,
        body: `Someone proposed how "${market.title}" resolved. You have ${windowLabel} to challenge it.`,
        url,
      };
    }
    case 'resolution_challenged':
      return { title: group.name, body: `The proposed resolution for "${market.title}" was challenged, cast your vote.`, url };
    case 'market_resolved': {
      if (isSubject) {
        return { title: group.name, body: `A market about you just resolved, come see what it was: "${market.title}"`, url: revealUrl };
      }
      const outcomeLabel = await marketOutcomeLabel(market);
      // A payout that exactly equals the stake means nobody took the other side, so there were no
      // losing stakes to split. Quoting it as "you won N tokens" overstates it (they're up
      // nothing), and framing it as winning your own bet back reads like a consolation prize when
      // the call was in fact correct. Say they won, and say the stake comes back.
      if (winnings && staked && winnings === staked) {
        return {
          title: group.name,
          body: `You called "${market.title}" right: ${outcomeLabel}. Nobody took the other side, so your ${staked} tokens come straight back.`,
          url: revealUrl,
        };
      }
      if (winnings) {
        return {
          title: group.name,
          body: `You won ${winnings} tokens! "${market.title}" resolved: ${outcomeLabel}.`,
          url: revealUrl,
        };
      }
      return { title: group.name, body: `"${market.title}" resolved: ${outcomeLabel}. See how it played out.`, url: revealUrl };
    }
    case 'market_voided':
      return { title: group.name, body: `The owner voided "${market.title}" and refunded every stake.`, url: revealUrl };
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
          ? `@${requester.nickname} isn't clear on how "${market.title}" resolves and is asking you to clarify.`
          : `Someone isn't clear on how "${market.title}" resolves and is asking you to clarify.`,
        url,
      };
    }
    case 'criteria_updated':
      return { title: group.name, body: `The resolution criteria for "${market.title}" just got clearer, take a look.`, url };
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

  // market_resolved's copy is per-recipient, not just per subject/non-subject: a winner gets their
  // own payout quoted, so every distinct winnings total needs its own buildContent call. Everyone
  // else (including subjects, who by construction never hold a bet on their own market) shares one
  // of the two content variants below, same as every other event type.
  if (event.event_type === 'market_resolved' && event.market_id) {
    // `amount` rides along with `payout` so the copy can tell a real win apart from a payout that
    // is exactly the stake coming back (a one-sided market, where there were no losing stakes to
    // split) — see the market_resolved case in buildContent.
    const { data: bets } = await admin
      .from('bets')
      .select('user_id, payout, amount')
      .eq('market_id', event.market_id)
      .not('payout', 'is', null)
      .gt('payout', 0);
    const payoutByUser = new Map<string, number>();
    const stakeByUser = new Map<string, number>();
    for (const b of bets ?? []) {
      payoutByUser.set(b.user_id, (payoutByUser.get(b.user_id) ?? 0) + b.payout);
      stakeByUser.set(b.user_id, (stakeByUser.get(b.user_id) ?? 0) + b.amount);
    }

    const contentCache = new Map<string, Content | null>();
    for (const userId of recipientIds) {
      const isSubject = subjectIds.has(userId);
      const winnings = payoutByUser.get(userId) ?? null;
      const staked = stakeByUser.get(userId) ?? null;
      const cacheKey = isSubject ? 'subject' : `winnings:${winnings}:${staked}`;
      let content = contentCache.get(cacheKey);
      if (content === undefined) {
        content = await buildContent(event, isSubject, winnings, staked);
        contentCache.set(cacheKey, content);
      }
      if (content) await sendToUser(userId, content);
    }
    return;
  }

  // Every other event type sends the same content to its whole recipient list.
  const nonSubjectContent = await buildContent(event, false);
  const subjectContent = subjectIds.size > 0 ? await buildContent(event, true) : null;

  for (const userId of recipientIds) {
    const content = subjectIds.has(userId) ? subjectContent : nonSubjectContent;
    if (content) await sendToUser(userId, content);
  }
}

// Error reporting, same Slack Incoming Webhook idea as the Next.js side (lib/errorReporter.ts)
// but standalone: an Edge Function shares no code with the app bundle, and this file has always
// preferred a few lines of its own over a dependency. A failure in here is invisible otherwise -
// the whole function runs on a cron with nobody watching its logs, so a broken push run used to
// mean silence in both senses. Optional and best-effort: unset, or unreachable, changes nothing.
const SLACK_ERROR_WEBHOOK_URL = Deno.env.get('SLACK_ERROR_WEBHOOK_URL');
const reportedThisRun = new Set<string>();

// Plain-English triage, same idea as lib/errorReporter.ts's. The failure surface here is much
// narrower (read the queue, build copy, hand off to a push service), so a handful of cases
// covers it.
function triage(message: string): { meaning: string; fix: string } {
  const t = message.toLowerCase();
  if (t.includes('does not exist') || t.includes('schema cache')) {
    return {
      meaning:
        'The push job asked the database for a column or function that is not there. Usually means a migration went live without this function being redeployed, or the other way round.',
      fix: 'Run `npx supabase functions deploy send-push --no-verify-jwt` and `npx supabase db push`. These are two separate steps and neither happens on a Vercel deploy.',
    };
  }
  if (t.includes('fcm') || t.includes('unregistered') || t.includes('oauth') || t.includes('invalid_grant')) {
    return {
      meaning: 'Sending to the native Android/iOS app failed. Browser and installed-PWA notifications are unaffected.',
      fix: 'Usually the Firebase service account secret. Re-set it with `npx supabase secrets set FCM_SERVICE_ACCOUNT_JSON_B64=...` (base64, not raw JSON) and redeploy the function.',
    };
  }
  if (t.includes('fetch failed') || t.includes('timeout') || t.includes('socket')) {
    return {
      meaning: 'A call out to a push service did not get through. Often a blip.',
      fix: 'Nothing to do if it happens once. The affected notifications are skipped, not retried, so a burst of these means some people missed a push.',
    };
  }
  return {
    meaning: 'The background job that sends push notifications hit something it did not expect while working through the queue.',
    fix: 'Paste this card into Claude Code. The queue keeps draining either way, so this is not urgent unless it keeps repeating: the one event that failed is marked processed and skipped, so somebody missed one notification.',
  };
}

async function reportToSlack(label: string, err: unknown, context?: Record<string, string>) {
  const message = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error ? (err.stack ?? '') : '';
  console.error(label, message, stack);
  if (!SLACK_ERROR_WEBHOOK_URL) return;
  // One Slack line per distinct failure per run: a bad event or a dead FCM config fails
  // identically for all 50 events in the batch, and 50 identical cards is not 50x the signal.
  const key = `${label}|${message}`;
  if (reportedThisRun.has(key)) return;
  reportedThisRun.add(key);

  try {
    // Slack answers a malformed Block Kit payload with 400 and a body naming the bad block
    // rather than failing the request, so an unchecked response means silent silence.
    const response = await fetch(SLACK_ERROR_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: `🚨 send-push: ${message.slice(0, 200)}`,
        blocks: [
          { type: 'header', text: { type: 'plain_text', text: '🚨 send-push', emoji: true } },
          { type: 'section', text: { type: 'mrkdwn', text: `*${label}*\n${message.slice(0, 800)}` } },
          {
            type: 'section',
            fields: [
              { type: 'mrkdwn', text: '*Where:*\nEdge Function (send-push)' },
              ...Object.entries(context ?? {}).map(([k, v]) => ({ type: 'mrkdwn', text: `*${k}:*\n${v}` })),
            ].slice(0, 10),
          },
          { type: 'section', text: { type: 'mrkdwn', text: `*What's happening*\n${triage(message).meaning}` } },
          { type: 'section', text: { type: 'mrkdwn', text: `*What to do*\n${triage(message).fix}` } },
          ...(stack ? [{ type: 'section', text: { type: 'mrkdwn', text: `\`\`\`${stack.slice(0, 2600)}\`\`\`` } }] : []),
          {
            type: 'context',
            elements: [
              {
                type: 'mrkdwn',
                text: 'This job only sends notifications, it never moves tokens, so no balance can be affected by anything here. One card per distinct failure per run.',
              },
            ],
          },
        ],
      }),
    });
    if (!response.ok) {
      console.error('Slack rejected the error report:', response.status, await response.text().catch(() => ''));
    }
  } catch (slackErr) {
    console.error('reportToSlack failed:', slackErr);
  }
}

Deno.serve(async (req) => {
  reportedThisRun.clear();

  const { data: events, error } = await admin
    .from('notification_events')
    .select('*')
    .is('processed_at', null)
    .order('created_at', { ascending: true })
    .limit(50);

  if (error) {
    await reportToSlack('could not read the notification queue', error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }

  let processed = 0;
  for (const event of (events ?? []) as NotificationEvent[]) {
    try {
      await processEvent(event);
    } catch (err) {
      await reportToSlack('event processing failed', err, { Event: `${event.event_type} \`${event.id}\`` });
    }
    // Marked processed after an attempt regardless of per-recipient send
    // failures (those are logged, not retried) — an event that crashed
    // before this point stays unprocessed and is picked up next run.
    await admin.from('notification_events').update({ processed_at: new Date().toISOString() }).eq('id', event.id);
    processed++;
  }

  return new Response(JSON.stringify({ processed }), { headers: { 'Content-Type': 'application/json' } });
});
