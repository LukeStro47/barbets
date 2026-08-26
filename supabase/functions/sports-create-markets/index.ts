// Polls The Odds API's free /events endpoint (fixture data only, no odds -- doesn't touch the
// per-market-region quota the way /odds does, since Barbets runs its own betting pool and has no
// use for anyone else's lines) for MLB/NBA/NFL games starting soon, and creates one moneyline
// "Will the {home} beat the {away}?" market per game in the seeded "Sports" group. Whichever
// league is actually in season is whichever one this naturally produces markets for -- no
// per-league on/off switch, just try all three every run.
//
// Unlike weather-resolve-markets, sports-resolve-markets doesn't need to parse the city back out
// of the title: it reconstructs the exact same title from the same home/away pair the scores
// endpoint returns, so lookup is an exact match rather than a regex.
import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ODDS_API_KEY = Deno.env.get('ODDS_API_KEY')!;
const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

const SPORTS = ['baseball_mlb', 'basketball_nba', 'americanfootball_nfl'];

// Games starting further out than this aren't created yet -- a "same day, resolves in a few
// hours" market, not a standing board of every game this week.
const LOOKAHEAD_MS = 12 * 3600_000;

interface OddsApiEvent {
  id: string;
  commence_time: string;
  home_team: string;
  away_team: string;
}

function marketTitle(homeTeam: string, awayTeam: string): string {
  return `Will the ${homeTeam} beat the ${awayTeam}?`;
}

async function stableId(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  const bytes = new Uint8Array(digest).slice(0, 16);
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

async function recordFailure(subject: string, err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  const { error } = await admin.rpc('_record_sweep_failure', {
    p_sweep: 'sports_market_create',
    p_subject_id: await stableId(subject),
    p_sqlstate: 'EDGEFN',
    p_message: message,
    p_context: err instanceof Error ? (err.stack ?? null) : null,
  });
  if (error) console.error(`recordFailure itself failed for ${subject}:`, error.message);
}

Deno.serve(async () => {
  const { data: setting } = await admin.from('pipeline_settings').select('enabled').eq('pipeline', 'sports').single();
  if (!setting?.enabled) return new Response('sports pipeline disabled', { status: 200 });

  const { data: group, error: groupErr } = await admin
    .from('groups')
    .select('id')
    .eq('name', 'Sports')
    .eq('is_public', true)
    .maybeSingle();
  if (groupErr || !group) {
    console.error('Sports group not found:', groupErr?.message);
    return new Response('Sports group not found', { status: 500 });
  }

  let created = 0;
  let failed = 0;

  for (const sport of SPORTS) {
    let events: OddsApiEvent[];
    try {
      const res = await fetch(`https://api.the-odds-api.com/v4/sports/${sport}/events?apiKey=${ODDS_API_KEY}`);
      if (!res.ok) throw new Error(`Odds API events request failed (${res.status}) for ${sport}`);
      events = await res.json();
    } catch (err) {
      failed++;
      await recordFailure(`${sport}-events-${new Date().toISOString().slice(0, 10)}`, err);
      continue;
    }

    const cutoff = Date.now() + LOOKAHEAD_MS;
    for (const event of events) {
      if (new Date(event.commence_time).getTime() > cutoff) continue;

      try {
        const title = marketTitle(event.home_team, event.away_team);

        const { data: existing } = await admin
          .from('markets')
          .select('id')
          .eq('group_id', group.id)
          .eq('title', title)
          .eq('closes_at', event.commence_time)
          .maybeSingle();
        if (existing) continue;

        const { error } = await admin.rpc('_create_system_market', {
          p_group_id: group.id,
          p_title: title,
          p_description: `Auto-generated from The Odds API. Resolves once the game is final; a tie voids the market.`,
          p_market_type: 'yes_no',
          p_closes_at: event.commence_time,
        });
        if (error) throw new Error(`create_market: ${error.message}`);
        created++;
      } catch (err) {
        failed++;
        await recordFailure(`event-${event.id}`, err);
      }
    }
  }

  await admin.rpc('_record_pipeline_run', { p_pipeline: 'sports', p_job: 'create', p_succeeded: created, p_failed: failed });

  return new Response(JSON.stringify({ created, failed }), { status: 200, headers: { 'Content-Type': 'application/json' } });
});
