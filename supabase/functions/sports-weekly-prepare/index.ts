// Monday-morning job, first half of the weekly Game of the Week pipeline. Replaces the old
// continuously-polling sports-create-markets (MLB/NBA/NFL moneylines, several markets a day,
// broke often on Odds API credits and stuck-market pileups). The new shape: once a week, fetch
// this week's NFL and CFB candidate games from The Odds API's free /events endpoint (fixtures
// only, no odds -- same reasoning as the old pipeline: this app runs its own pool and never
// needed anyone else's lines), store them in game_of_week_picks, and ping an admin on Slack to
// pick one game per league. sports-weekly-publish (Tuesday morning) turns that pick -- or, if
// nobody made one, a sensible fallback -- into the week's actual market.
//
// Idempotent by design: a rerun in the same window (a retry, a manual re-trigger) is a no-op for
// any league that already has a row for this week_key, whatever its status -- this must never
// clobber an admin's already-made pick or reshuffle the candidate list out from under them.
import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ODDS_API_KEY = Deno.env.get('ODDS_API_KEY')!;
const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

// Mirrors lib/appOrigin.ts's APP_ORIGIN -- Edge Functions can't import from the Next.js app, so
// this is a deliberate, small duplication rather than a shared package for one constant.
const APP_ORIGIN = 'https://app.mybarbets.com';

const SLACK_WEBHOOK_URL = Deno.env.get('SLACK_GAME_PICK_WEBHOOK_URL');

const LEAGUES: { league: 'nfl' | 'cfb'; oddsApiSport: string; groupName: string; label: string }[] = [
  { league: 'nfl', oddsApiSport: 'americanfootball_nfl', groupName: 'NFL', label: 'NFL' },
  { league: 'cfb', oddsApiSport: 'americanfootball_ncaaf', groupName: 'CFB', label: 'CFB' },
];

// A candidate needs to start at least this far out -- by the time it's actually published
// (roughly a day later, Tuesday morning) there must still be a real betting window before
// kickoff. This also naturally excludes whatever's left of the week that just finished (a
// Monday-morning run landing after last night's Monday Night Football, say).
const MIN_LEAD_MS = 24 * 3600_000;

// How far out candidates are pulled -- comfortably past next Monday night (the far edge of a
// full NFL week: Thursday through Monday), so both leagues' entire upcoming slate is visible to
// the admin in one pass.
const MAX_LEAD_MS = 8 * 24 * 3600_000;

interface OddsApiEvent {
  id: string;
  commence_time: string;
  home_team: string;
  away_team: string;
}

/** The nearest Tuesday on or after `from`, as a plain UTC date string -- the key both this
    function and sports-weekly-publish use to agree on "which week" a row belongs to. Tuesday
    (not Monday) since that's the day the market actually goes out; a prepare run the day before
    naturally lands on the same key as the publish run it feeds. */
function nextTuesdayUtcDate(from: Date): string {
  const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  const daysUntilTuesday = (2 - d.getUTCDay() + 7) % 7;
  d.setUTCDate(d.getUTCDate() + daysUntilTuesday);
  return d.toISOString().slice(0, 10);
}

/** Deterministic, not random -- sweep_failures upserts on (sweep, subject_id), so the same
    logical failure (same league, same week) needs to hash to the same id across retries or every
    run looks like a brand new failure. Same trick every other pipeline's recordFailure uses. */
async function stableId(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  const bytes = new Uint8Array(digest).slice(0, 16);
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

async function recordFailure(subject: string, err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  const { error } = await admin.rpc('_record_sweep_failure', {
    p_sweep: 'sports_weekly_prepare',
    p_subject_id: await stableId(subject),
    p_sqlstate: 'EDGEFN',
    p_message: message,
    p_context: err instanceof Error ? (err.stack ?? null) : null,
  });
  if (error) console.error(`recordFailure itself failed for ${subject}:`, error.message);
}

/** Best-effort only -- a failed Slack post never fails the run, the candidates are already
    durably saved by the time this is called. See lib/actions/feedback.ts's postToSlack for the
    same posture and Block Kit shape on the Next.js side of this app. */
async function pingAdmin(newlyPrepared: { label: string; count: number }[]) {
  if (!SLACK_WEBHOOK_URL || newlyPrepared.length === 0) return;
  try {
    await fetch(SLACK_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: `🏈 This week's Game of the Week candidates are ready to pick.`,
        blocks: [
          { type: 'header', text: { type: 'plain_text', text: '🏈 Game of the Week', emoji: true } },
          {
            type: 'section',
            fields: newlyPrepared.map((p) => ({ type: 'mrkdwn', text: `*${p.label}:*\n${p.count} candidate${p.count === 1 ? '' : 's'}` })),
          },
          {
            type: 'section',
            text: { type: 'mrkdwn', text: `Pick this week's game before Tuesday morning: <${APP_ORIGIN}/admin/game-of-the-week>` },
          },
          {
            type: 'context',
            elements: [{ type: 'mrkdwn', text: 'No pick by Tuesday morning and the system auto-selects the latest-kickoff game instead.' }],
          },
        ],
      }),
    });
  } catch (err) {
    console.error('pingAdmin failed to reach Slack:', err);
  }
}

Deno.serve(async () => {
  const { data: setting } = await admin.from('pipeline_settings').select('enabled').eq('pipeline', 'sports').single();
  if (!setting?.enabled) return new Response('sports pipeline disabled', { status: 200 });

  const now = new Date();
  const weekKey = nextTuesdayUtcDate(now);
  const cutoffMin = now.getTime() + MIN_LEAD_MS;
  const cutoffMax = now.getTime() + MAX_LEAD_MS;

  let prepared = 0;
  let failed = 0;
  const newlyPrepared: { label: string; count: number }[] = [];

  for (const { league, oddsApiSport, groupName, label } of LEAGUES) {
    try {
      const { data: existing } = await admin
        .from('game_of_week_picks')
        .select('id')
        .eq('league', league)
        .eq('week_key', weekKey)
        .maybeSingle();
      if (existing) continue;

      const { data: group, error: groupErr } = await admin.from('groups').select('id').eq('name', groupName).eq('is_public', true).maybeSingle();
      if (groupErr || !group) throw new Error(`${groupName} group not found: ${groupErr?.message ?? 'no row'}`);

      const res = await fetch(`https://api.the-odds-api.com/v4/sports/${oddsApiSport}/events?apiKey=${ODDS_API_KEY}`);
      if (!res.ok) throw new Error(`Odds API events request failed (${res.status}) for ${oddsApiSport}`);
      const events: OddsApiEvent[] = await res.json();

      const candidates = events
        .filter((e) => {
          const commenceMs = new Date(e.commence_time).getTime();
          return commenceMs > cutoffMin && commenceMs <= cutoffMax;
        })
        .sort((a, b) => new Date(a.commence_time).getTime() - new Date(b.commence_time).getTime())
        .map((e) => ({ event_id: e.id, home: e.home_team, away: e.away_team, commence_time: e.commence_time }));

      // A bye week (no games in the window at all) still gets a row, just with an empty
      // candidate list -- sports-weekly-publish reads that the same way it reads a league that
      // never got picked, except there's nothing to fall back to either, so it leaves the week
      // skipped rather than erroring.
      const { error: insertErr } = await admin.from('game_of_week_picks').insert({
        league,
        week_key: weekKey,
        group_id: group.id,
        candidates,
        status: 'awaiting_pick',
      });
      if (insertErr) throw new Error(`insert game_of_week_picks: ${insertErr.message}`);

      prepared++;
      newlyPrepared.push({ label, count: candidates.length });
    } catch (err) {
      failed++;
      await recordFailure(`${league}-${weekKey}`, err);
    }
  }

  await pingAdmin(newlyPrepared);

  await admin.rpc('_record_pipeline_run', { p_pipeline: 'sports', p_job: 'weekly_prepare', p_succeeded: prepared, p_failed: failed });

  return new Response(JSON.stringify({ prepared, failed }), { status: 200, headers: { 'Content-Type': 'application/json' } });
});
