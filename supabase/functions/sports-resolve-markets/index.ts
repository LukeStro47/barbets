// Polls The Odds API's /scores endpoint for completed games and resolves the matching market
// (found by reconstructing the exact title sports-create-markets would have generated for the
// same home/away pair and commence_time -- an exact lookup, not a regex parse, since this
// function already has the same team names the create side used). marketTitle() here must always
// match sports-create-markets/index.ts's own copy exactly, including across a deploy that changes
// the format -- any market already open under the old title at the moment of that deploy won't be
// found by the new lookup and falls back to a moderator's ordinary hand-resolve, same as a game
// that ages out of the DAYS_FROM lookback window.
//
// Sports markets are multiple_choice (one option per team), not yes_no -- resolving means finding
// the winning team's own market_options row and passing its id as p_option_id, not picking 'yes'
// or 'no'. The option's label is always the exact team name sports-create-markets used to create
// it (same string _create_system_market stored verbatim), so this is a plain lookup, not a parse.
import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ODDS_API_KEY = Deno.env.get('ODDS_API_KEY')!;
const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

const SPORTS = ['baseball_mlb', 'basketball_nba', 'americanfootball_nfl'];

// How far back completed games are still worth checking -- generous enough that a run missed
// during an outage still catches up once the pipeline is back.
const DAYS_FROM = 2;

interface OddsApiScore {
  id: string;
  commence_time: string;
  completed: boolean;
  home_team: string;
  away_team: string;
  scores: { name: string; score: string }[] | null;
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
    p_sweep: 'sports_market_resolve',
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

  let resolved = 0;
  let failed = 0;

  for (const sport of SPORTS) {
    let games: OddsApiScore[];
    try {
      const res = await fetch(`https://api.the-odds-api.com/v4/sports/${sport}/scores?apiKey=${ODDS_API_KEY}&daysFrom=${DAYS_FROM}`);
      if (!res.ok) throw new Error(`Odds API scores request failed (${res.status}) for ${sport}`);
      games = await res.json();
    } catch (err) {
      failed++;
      await recordFailure(`${sport}-scores-${new Date().toISOString().slice(0, 10)}`, err);
      continue;
    }

    for (const game of games) {
      if (!game.completed || !game.scores) continue;

      try {
        const title = marketTitle(game.home_team, game.away_team);

        const { data: market } = await admin
          .from('markets')
          .select('id, status, market_options(id, label)')
          .eq('group_id', group.id)
          .eq('title', title)
          .eq('closes_at', game.commence_time)
          .maybeSingle();
        if (!market || !['open', 'closed'].includes(market.status)) continue;

        const homeScore = Number(game.scores.find((s) => s.name === game.home_team)?.score);
        const awayScore = Number(game.scores.find((s) => s.name === game.away_team)?.score);
        if (!Number.isFinite(homeScore) || !Number.isFinite(awayScore)) {
          throw new Error(`missing or unparseable score for "${title}"`);
        }

        let error: { message: string } | null;
        if (homeScore === awayScore) {
          ({ error } = await admin.rpc('_resolve_system_market', { p_market_id: market.id, p_outcome: 'void' }));
        } else {
          const winningTeam = homeScore > awayScore ? game.home_team : game.away_team;
          const winningOption = market.market_options?.find((o: { id: string; label: string }) => o.label === winningTeam);
          if (!winningOption) throw new Error(`no market_options row for winning team "${winningTeam}" on "${title}"`);
          ({ error } = await admin.rpc('_resolve_system_market', { p_market_id: market.id, p_option_id: winningOption.id }));
        }
        if (error) {
          // Nothing stops a moderator from hand-resolving a system market through the ordinary
          // UI (is_system_market doesn't gate propose_resolution), and status is checked here
          // client-side before this call takes its own row lock -- so a market that moved past
          // open/closed in the gap between those two reads (a mod's own resolve, or another
          // overlapping run) races this one to "not awaiting a resolution proposal" once in a
          // while. That's someone/something else already having handled it, not a real failure.
          if (error.message.includes('not awaiting a resolution proposal')) continue;
          throw new Error(`resolve: ${error.message}`);
        }
        resolved++;
      } catch (err) {
        failed++;
        await recordFailure(`game-${game.id}`, err);
      }
    }
  }

  const { error: pruneErr } = await admin.rpc('_prune_resolved_system_markets');
  if (pruneErr) console.error('_prune_resolved_system_markets failed:', pruneErr.message);

  await admin.rpc('_record_pipeline_run', { p_pipeline: 'sports', p_job: 'resolve', p_succeeded: resolved, p_failed: failed });

  return new Response(JSON.stringify({ resolved, failed }), { status: 200, headers: { 'Content-Type': 'application/json' } });
});
