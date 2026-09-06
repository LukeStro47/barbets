// Resolves the week's NFL and CFB Game of the Week markets once The Odds API reports the game
// final. Trimmed down from its old shape (which polled MLB/NBA/NFL against one shared "Sports"
// group) to match the new weekly-pick pipeline: two groups, one league each, at most one open
// market per group at a time -- see sports-weekly-prepare/sports-weekly-publish for how that
// market gets created in the first place.
//
// marketTitle() here must always match sports-weekly-publish's own copy exactly: lookup is an
// exact title match (reconstructed from the same home/away pair this endpoint returns), not a
// regex parse, since this function already has the same team names the create side used.
//
// Sports markets are multiple_choice (one option per team), not yes_no -- resolving means finding
// the winning team's own market_options row and passing its id as p_option_id, not picking 'yes'
// or 'no'. The option's label is always the exact team name sports-weekly-publish used to create
// it (same string _create_system_market stored verbatim), so this is a plain lookup, not a parse.
import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ODDS_API_KEY = Deno.env.get('ODDS_API_KEY')!;
const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

const LEAGUES: { oddsApiSport: string; groupName: string }[] = [
  { oddsApiSport: 'americanfootball_nfl', groupName: 'NFL' },
  { oddsApiSport: 'americanfootball_ncaaf', groupName: 'CFB' },
];

// How far back completed games are still worth checking -- generous enough that a run missed
// during an outage still catches up once the pipeline is back. Unchanged from the old pipeline:
// with only one market per league per week now, the API-credit pressure that originally forced
// resolve down to every 6 hours (see that migration) is far lower, but the lookback window itself
// was never about credits.
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

  let resolved = 0;
  let failed = 0;

  for (const { oddsApiSport, groupName } of LEAGUES) {
    const { data: group, error: groupErr } = await admin.from('groups').select('id').eq('name', groupName).eq('is_public', true).maybeSingle();
    if (groupErr || !group) {
      failed++;
      await recordFailure(`${groupName}-group-lookup`, new Error(groupErr?.message ?? `${groupName} group not found`));
      continue;
    }

    let games: OddsApiScore[];
    try {
      const res = await fetch(`https://api.the-odds-api.com/v4/sports/${oddsApiSport}/scores?apiKey=${ODDS_API_KEY}&daysFrom=${DAYS_FROM}`);
      if (!res.ok) throw new Error(`Odds API scores request failed (${res.status}) for ${oddsApiSport}`);
      games = await res.json();
    } catch (err) {
      failed++;
      await recordFailure(`${oddsApiSport}-scores-${new Date().toISOString().slice(0, 10)}`, err);
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
