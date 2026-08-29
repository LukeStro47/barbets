// Polls The Odds API's free /events endpoint (fixture data only, no odds -- doesn't touch the
// per-market-region quota the way /odds does, since Barbets runs its own betting pool and has no
// use for anyone else's lines) for MLB/NBA/NFL games starting soon, and creates one moneyline
// "{home} vs. {away}" market per game in the seeded "Sports" group -- the description spells out
// what YES/NO mean, since the title alone (unlike the old "Will the {home} beat the {away}?"
// phrasing) no longer does. Whichever league is actually in season is whichever one this naturally
// produces markets for -- no per-league on/off switch, just try all three every run.
//
// Candidates are taken round-robin across leagues (one game per league per pass), not by draining
// SPORTS[0]'s whole eligible list before ever looking at SPORTS[1]. With OPEN_MARKET_CAP this low,
// exhaust-then-move-on meant whichever league happened to list first (baseball_mlb) and had 3+
// games in the lookahead window claimed every slot every run, regardless of whether NBA/NFL also
// had games that day -- not a seasonality effect, just first-in-the-array always winning. Found
// 2026-08-29 during MLB's regular season overlapping NFL preseason, where NFL never got a single
// market despite having games in the window.
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

// How much runway a game needs before its own commence_time to be worth creating a market for --
// not just the race-condition safety margin against _create_system_market()'s own "must be in the
// future" check (which only needs a couple of minutes), but a real betting window. This used to be
// that couple-of-minutes margin alone, which meant a run polling later in a game's build-up (the
// function runs twice a day) would happily create a market for a game starting in 5-10 minutes --
// technically "in the future," but nobody had a real chance to place a bet before it closed.
// Found from watching the pipeline run against real data, 2026-08-29.
const CREATE_MIN_LEAD_MS = 30 * 60_000;

// No more than this many Sports system markets open at once -- a run that would otherwise create
// more just stops early, first game found first; whatever gets skipped catches up on a later run
// once something closes.
const OPEN_MARKET_CAP = 3;

interface OddsApiEvent {
  id: string;
  commence_time: string;
  home_team: string;
  away_team: string;
}

function marketTitle(homeTeam: string, awayTeam: string): string {
  return `${homeTeam} vs. ${awayTeam}`;
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

  const { count: openCount } = await admin
    .from('markets')
    .select('id', { count: 'exact', head: true })
    .eq('group_id', group.id)
    .eq('is_system_market', true)
    .eq('status', 'open');
  let openSlots = OPEN_MARKET_CAP - (openCount ?? 0);

  let created = 0;
  let failed = 0;
  const createdMarketIds: string[] = [];

  // One eligible-events queue per league, each already time-sorted by the API's own /events
  // response order (soonest first) -- fetched up front for every league regardless of openSlots,
  // since /events doesn't spend Odds API usage credits (see the header comment) and this run needs
  // to see all three leagues' candidates before it can interleave between them.
  const queues: OddsApiEvent[][] = [];
  const cutoff = Date.now() + LOOKAHEAD_MS;
  for (const sport of SPORTS) {
    let events: OddsApiEvent[];
    try {
      const res = await fetch(`https://api.the-odds-api.com/v4/sports/${sport}/events?apiKey=${ODDS_API_KEY}`);
      if (!res.ok) throw new Error(`Odds API events request failed (${res.status}) for ${sport}`);
      events = await res.json();
    } catch (err) {
      failed++;
      await recordFailure(`${sport}-events-${new Date().toISOString().slice(0, 10)}`, err);
      queues.push([]);
      continue;
    }

    queues.push(
      events.filter((event) => {
        const commenceMs = new Date(event.commence_time).getTime();
        // The free /events endpoint keeps returning a game for a while after it has actually
        // started (live, or even final), not just upcoming ones -- skip those too, the same way
        // weather-create-markets skips a market whose noon-local close has already passed, or
        // _create_system_market rejects it with "closes_at must be in the future" every run.
        return commenceMs <= cutoff && commenceMs > Date.now() + CREATE_MIN_LEAD_MS;
      })
    );
  }

  // Round-robin across leagues, one game per league per pass, so a league with many games in the
  // window (baseball_mlb, in season) can't claim every open slot before a league with only a
  // couple (americanfootball_nfl preseason, say) ever gets a turn.
  outer: while (openSlots > 0) {
    let madeProgress = false;
    for (const queue of queues) {
      if (openSlots <= 0) break outer;
      const event = queue.shift();
      if (!event) continue;
      madeProgress = true;

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

        const { data, error } = await admin.rpc('_create_system_market', {
          p_group_id: group.id,
          p_title: title,
          p_description: `Auto-generated from The Odds API. YES means the ${event.home_team} win, NO means the ${event.away_team} win. Resolves once the game is final; a tie voids the market.`,
          p_market_type: 'yes_no',
          p_closes_at: event.commence_time,
        });
        if (error) throw new Error(`create_market: ${error.message}`);
        created++;
        openSlots--;
        if (data?.id) createdMarketIds.push(data.id);
      } catch (err) {
        failed++;
        await recordFailure(`event-${event.id}`, err);
      }
    }
    if (!madeProgress) break;
  }

  // One push per run, not one per market -- a run that finds several games at once (common with
  // three leagues polled every run) should read as "new markets, come take a look" rather than a
  // burst of identically-shaped pushes. See _notify_system_markets_created().
  if (createdMarketIds.length > 0) {
    await admin.rpc('_notify_system_markets_created', { p_group_id: group.id, p_market_ids: createdMarketIds });
  }

  await admin.rpc('_record_pipeline_run', { p_pipeline: 'sports', p_job: 'create', p_succeeded: created, p_failed: failed });

  return new Response(JSON.stringify({ created, failed }), { status: 200, headers: { 'Content-Type': 'application/json' } });
});
