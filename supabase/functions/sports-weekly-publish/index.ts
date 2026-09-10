// Tuesday-morning job, second half of the weekly Game of the Week pipeline (see
// sports-weekly-prepare's header comment for the full shape). For each league, turns this week's
// game_of_week_picks row into the actual market: the admin's own pick if they made one before
// this ran, or -- so the group never goes dark on an admin who didn't get to it in time -- the
// candidate with the latest kickoff as a sensible default (the closest this pipeline gets to
// "the marquee game" without paying for real odds, which this app has never needed -- see
// sports-weekly-prepare's header comment on why candidates are odds-free).
//
// A market is `multiple_choice` with the two team names as its options, "{home} vs. {away}" as
// the title -- identical shape to what the old sports-create-markets used for its moneylines, for
// the same reason (see that function's former header comment, preserved in ARCHITECTURE.md): a
// neutral "vs." title has no yes_no explainer, but two named options need no explaining at all.
import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

const LEAGUES: ('nfl' | 'cfb')[] = ['nfl', 'cfb'];

interface Candidate {
  event_id: string;
  home: string;
  away: string;
  commence_time: string;
}

interface PickRow {
  id: string;
  league: 'nfl' | 'cfb';
  week_key: string;
  group_id: string;
  candidates: Candidate[];
  chosen_event_id: string | null;
  chosen_by: string | null;
  status: 'awaiting_pick' | 'picked' | 'published' | 'skipped';
}

/** Same week-key rule as sports-weekly-prepare -- both functions must agree on what "this week"
    means with no shared table to coordinate through. */
function nextTuesdayUtcDate(from: Date): string {
  const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  const daysUntilTuesday = (2 - d.getUTCDay() + 7) % 7;
  d.setUTCDate(d.getUTCDate() + daysUntilTuesday);
  return d.toISOString().slice(0, 10);
}

function marketTitle(home: string, away: string): string {
  return `${home} vs. ${away}`;
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
    p_sweep: 'sports_weekly_publish',
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

  const weekKey = nextTuesdayUtcDate(new Date());

  let published = 0;
  let failed = 0;

  for (const league of LEAGUES) {
    try {
      const { data: row, error: rowErr } = await admin
        .from('game_of_week_picks')
        .select('id, league, week_key, group_id, candidates, chosen_event_id, chosen_by, status')
        .eq('league', league)
        .eq('week_key', weekKey)
        .maybeSingle<PickRow>();
      if (rowErr) throw new Error(`fetch pick row: ${rowErr.message}`);

      // No row means sports-weekly-prepare hasn't run for this week yet (or failed outright) --
      // worth surfacing as a stuck failure rather than silently doing nothing, since there's no
      // later run this week that would ever pick it back up on its own.
      if (!row) throw new Error(`no game_of_week_picks row for ${league}/${weekKey} -- did sports-weekly-prepare run?`);

      if (row.status === 'published' || row.status === 'skipped') continue;

      if (row.candidates.length === 0) {
        await admin.from('game_of_week_picks').update({ status: 'skipped' }).eq('id', row.id);
        continue;
      }

      let chosenEventId = row.chosen_event_id;
      let chosenBy = row.chosen_by;
      if (row.status === 'awaiting_pick') {
        // Sorted soonest-first by sports-weekly-prepare, so the last entry has the latest kickoff.
        const fallback = row.candidates[row.candidates.length - 1];
        chosenEventId = fallback.event_id;
        chosenBy = null;
      }

      const chosen = row.candidates.find((c) => c.event_id === chosenEventId);
      if (!chosen) throw new Error(`chosen_event_id "${chosenEventId}" is not one of this row's own candidates`);

      const { data: market, error: createErr } = await admin.rpc('_create_system_market', {
        p_group_id: row.group_id,
        p_title: marketTitle(chosen.home, chosen.away),
        p_description: `Auto-generated Game of the Week pick from The Odds API. Resolves once the game is final; a tie voids the market.`,
        p_market_type: 'multiple_choice',
        p_closes_at: chosen.commence_time,
        p_options: [chosen.home, chosen.away],
      });
      if (createErr) {
        // 23505 (unique_violation) means a concurrent invocation already published this week's
        // game for this league in the gap between reading the pick row's status above and
        // writing 'published' back to it below -- see
        // markets_system_market_active_group_closes_at_key and ARCHITECTURE.md's note on the
        // race this closes. Whichever request won already ran the update/notify below, so
        // there's nothing left for this one to do.
        if (createErr.code === '23505') continue;
        throw new Error(`create_market: ${createErr.message}`);
      }

      const { error: updateErr } = await admin
        .from('game_of_week_picks')
        .update({
          chosen_event_id: chosenEventId,
          chosen_by: chosenBy,
          status: 'published',
          market_id: market.id,
          published_at: new Date().toISOString(),
        })
        .eq('id', row.id);
      if (updateErr) throw new Error(`update game_of_week_picks: ${updateErr.message}`);

      // Single market per league per week, so this always resolves to the named market_opened
      // push, never the consolidated system_markets_opened one -- but calling the same shared
      // function every other pipeline uses keeps that decision in one place rather than
      // duplicating it here.
      await admin.rpc('_notify_system_markets_created', { p_group_id: row.group_id, p_market_ids: [market.id] });

      published++;
    } catch (err) {
      failed++;
      await recordFailure(`${league}-${weekKey}`, err);
    }
  }

  await admin.rpc('_record_pipeline_run', { p_pipeline: 'sports', p_job: 'weekly_publish', p_succeeded: published, p_failed: failed });

  return new Response(JSON.stringify({ published, failed }), { status: 200, headers: { 'Content-Type': 'application/json' } });
});
