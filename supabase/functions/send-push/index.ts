// Drains notification_events (written by the Postgres functions themselves
// — see 20260707192239_notification_events.sql — so this covers both
// human-triggered and cron-triggered transitions equally) and sends real
// web push notifications. Invoked on a schedule; see the README for how
// it's wired up (pg_cron + pg_net, since Supabase's scheduled-function
// support and pg_cron availability both vary by project).
import webpush from 'npm:web-push@3.6.7';
import { createClient } from 'npm:@supabase/supabase-js@2';

const VAPID_PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY')!;
const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY')!;
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

webpush.setVapidDetails('mailto:barbets-app@example.com', VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

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
  const { data: subs } = await admin.from('push_subscriptions').select('id, endpoint, p256dh, auth_key').eq('user_id', userId);
  for (const sub of subs ?? []) {
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
