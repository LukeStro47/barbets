// Afternoon/evening job: resolves every weather-create-markets market whose closes_at has
// passed, against the nearest station's observations for that local calendar day. Re-derives
// which city (and which kind of market) from the title text weather-create-markets generates --
// see that function's header comment for why there's no separate metadata table.
//
// Both markets close at noon local but ask about the whole day ("will it rain today," "will it
// hit X°F today"), and this function's first run after that close can land as early as 12:00-12:30
// local. A "yes"/"over" is safe to resolve the moment it's true (rain, or a temperature at or past
// the line, can't become un-true later in the day), but a "no"/"under" resolved off a single early
// reading is a real bug, not a simplification: the day's actual high usually lands mid-afternoon,
// well after noon, and "hasn't rained/hasn't hit the line yet" said at 12:30 says nothing about the
// rest of the day. This function used to do exactly that (single latest-observation read, resolved
// the instant closes_at passed), which is how a Chicago "will it hit 84°F" market resolved before
// 2pm off a reading that was never going to be the day's peak. The fix: pull every observation
// since local midnight (not just the latest) and take the day's max-so-far / any-rain-so-far
// across all of them, and only ever finalize the negative case (no rain / under the line) once
// EVENING_CUTOFF_HOUR_LOCAL has passed -- by which point the day's real high and any rain chance
// are both effectively decided. Before that cutoff, an undecided negative just skips this run and
// tries again on the next one (every 30 minutes), the same "not yet, not a failure" shape the
// "someone already resolved it" race below already uses.
import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

const USER_AGENT = '(barbets-app, barbets-app@example.com)';

const CITIES = [
  { name: 'New York', lat: 40.7128, lon: -74.006 },
  { name: 'Chicago', lat: 41.8781, lon: -87.6298 },
  { name: 'Los Angeles', lat: 34.0522, lon: -118.2437 },
];

// A negative result ("no rain", "under the line") only finalizes once local time is at or past
// this hour -- well past the typical daily high (~3-5pm) and past the point an afternoon/evening
// shower would still meaningfully be "today's weather." A positive result never waits on this.
const EVENING_CUTOFF_HOUR_LOCAL = 20;

async function nwsFetch(url: string): Promise<any> {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/geo+json' } });
  if (!res.ok) throw new Error(`NWS request failed (${res.status}): ${url}`);
  return res.json();
}

/** Unlike weather-create-markets (which has no real row id to key off yet), a market being
    resolved already has a real uuid -- use it directly rather than hashing, so sweep_failures
    rows correlate straight back to the market. */
async function recordFailure(marketId: string, err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  const { error } = await admin.rpc('_record_sweep_failure', {
    p_sweep: 'weather_market_resolve',
    p_subject_id: marketId,
    p_sqlstate: 'EDGEFN',
    p_message: message,
    p_context: err instanceof Error ? (err.stack ?? null) : null,
  });
  if (error) console.error(`recordFailure itself failed for ${marketId}:`, error.message);
}

/** The local calendar-day parts (and hour) `date` falls on in `timeZone` -- used both to find
    local midnight for a given day and to check how far into that day "now" already is. */
function localParts(date: Date, timeZone: string): { year: number; month: number; day: number; hour: number } {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
  });
  const parts = Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value]));
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: parts.hour === '24' ? 0 : Number(parts.hour),
  };
}

/** The UTC instant for local midnight on the same calendar day `refDate` falls on in `timeZone` --
    DST-correct via the same guess-then-correct trick weather-create-markets' own
    localHourTodayToUtcIso() uses, generalized to hour 0 on a caller-supplied day (that market's own
    closing day) rather than always "today." */
function localMidnightUtcIso(refDate: Date, timeZone: string): string {
  const dateFmt = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
  const dateParts = Object.fromEntries(dateFmt.formatToParts(refDate).map((p) => [p.type, p.value]));
  const guess = new Date(Date.UTC(Number(dateParts.year), Number(dateParts.month) - 1, Number(dateParts.day), 0, 0, 0));
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = Object.fromEntries(fmt.formatToParts(guess).map((p) => [p.type, p.value]));
  const hourPart = parts.hour === '24' ? 0 : Number(parts.hour);
  const readAsUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), hourPart, Number(parts.minute), Number(parts.second));
  const offsetMs = readAsUtc - guess.getTime();
  return new Date(guess.getTime() - offsetMs).toISOString();
}

/** True once local time has rolled past EVENING_CUTOFF_HOUR_LOCAL on the market's own closing
    day, or into a later calendar day entirely (a run that lagged well behind closes_at) -- either
    way, the day this market asked about is over and a negative result is safe to finalize. */
function dayIsLikelyOver(closesAt: string, timeZone: string): boolean {
  const now = localParts(new Date(), timeZone);
  const closes = localParts(new Date(closesAt), timeZone);
  if (now.year !== closes.year || now.month !== closes.month || now.day !== closes.day) return true;
  return now.hour >= EVENING_CUTOFF_HOUR_LOCAL;
}

/** Every observation from local midnight (on the market's own closing day) through now, collapsed
    to the two facts either market type needs: the day's highest temperature reading so far, and
    whether rain/showers/drizzle showed up in any reading so far. Deliberately not just the latest
    observation -- see this file's header comment for why that was the bug. */
async function todaysObservations(
  city: { lat: number; lon: number },
  closesAt: string
): Promise<{ maxTempF: number | null; rainedSoFar: boolean; timeZone: string }> {
  const point = await nwsFetch(`https://api.weather.gov/points/${city.lat},${city.lon}`);
  const stations = await nwsFetch(point.properties.observationStations);
  const stationId = stations.features[0].properties.stationIdentifier;
  const timeZone: string = point.properties.timeZone;

  const start = localMidnightUtcIso(new Date(closesAt), timeZone);
  const obsList = await nwsFetch(`https://api.weather.gov/stations/${stationId}/observations?start=${encodeURIComponent(start)}`);
  const features: any[] = obsList.features ?? [];
  if (features.length === 0) throw new Error(`no observations returned for station ${stationId} since ${start}`);

  let maxTempF: number | null = null;
  let rainedSoFar = false;
  for (const feature of features) {
    const tempC = feature.properties?.temperature?.value;
    if (tempC !== null && tempC !== undefined) {
      const tempF = Math.round((tempC * 9) / 5 + 32);
      if (maxTempF === null || tempF > maxTempF) maxTempF = tempF;
    }
    if (/rain|shower|drizzle/i.test(feature.properties?.textDescription ?? '')) rainedSoFar = true;
  }

  return { maxTempF, rainedSoFar, timeZone };
}

Deno.serve(async () => {
  const { data: setting } = await admin.from('pipeline_settings').select('enabled').eq('pipeline', 'weather').single();
  if (!setting?.enabled) return new Response('weather pipeline disabled', { status: 200 });

  const { data: group, error: groupErr } = await admin
    .from('groups')
    .select('id')
    .eq('name', 'Weather')
    .eq('is_public', true)
    .maybeSingle();
  if (groupErr || !group) {
    console.error('Weather group not found:', groupErr?.message);
    return new Response('Weather group not found', { status: 500 });
  }

  const { data: markets, error: marketsErr } = await admin
    .from('markets')
    .select('id, title, market_type, line, closes_at')
    .eq('group_id', group.id)
    .in('status', ['open', 'closed'])
    .lte('closes_at', new Date().toISOString());
  if (marketsErr) {
    console.error('Failed to list markets to resolve:', marketsErr.message);
    return new Response('Failed to list markets', { status: 500 });
  }

  let resolved = 0;
  let failed = 0;

  for (const market of markets ?? []) {
    try {
      const rainMatch = market.title.match(/^Will it rain in (.+) today\?$/);
      const tempMatch = market.title.match(/^Will (.+) hit -?\d+°F today\?$/);
      const cityName = rainMatch?.[1] ?? tempMatch?.[1];
      const city = CITIES.find((c) => c.name === cityName);
      if (!city) throw new Error(`could not identify city from title "${market.title}"`);

      const { maxTempF, rainedSoFar, timeZone } = await todaysObservations(city, market.closes_at);

      if (rainMatch) {
        if (rainedSoFar) {
          const { error } = await admin.rpc('_resolve_system_market', { p_market_id: market.id, p_outcome: 'yes' });
          if (error) {
            // Nothing stops a moderator from hand-resolving a system market through the ordinary
            // UI (is_system_market doesn't gate propose_resolution) -- if they beat this run to it
            // (or an overlapping run did), the market has already moved past open/closed and this
            // raises "not awaiting a resolution proposal." That's someone/something else already
            // having handled it, not a real failure, and not this run's resolve to count either.
            if (error.message.includes('not awaiting a resolution proposal')) continue;
            throw new Error(`resolve rain market: ${error.message}`);
          }
          resolved++;
        } else if (dayIsLikelyOver(market.closes_at, timeZone)) {
          const { error } = await admin.rpc('_resolve_system_market', { p_market_id: market.id, p_outcome: 'no' });
          if (error) {
            if (error.message.includes('not awaiting a resolution proposal')) continue;
            throw new Error(`resolve rain market: ${error.message}`);
          }
          resolved++;
        }
        // else: no rain yet, and the day isn't over -- too early to call it, try again next run.
      } else if (tempMatch) {
        if (maxTempF !== null && maxTempF >= market.line) {
          const { error } = await admin.rpc('_resolve_system_market', {
            p_market_id: market.id,
            p_outcome: 'over',
            p_actual_value: maxTempF,
          });
          if (error) {
            if (error.message.includes('not awaiting a resolution proposal')) continue;
            throw new Error(`resolve temp market: ${error.message}`);
          }
          resolved++;
        } else if (dayIsLikelyOver(market.closes_at, timeZone)) {
          if (maxTempF === null) throw new Error('station has no temperature reading for today');
          const { error } = await admin.rpc('_resolve_system_market', {
            p_market_id: market.id,
            p_outcome: 'under',
            p_actual_value: maxTempF,
          });
          if (error) {
            if (error.message.includes('not awaiting a resolution proposal')) continue;
            throw new Error(`resolve temp market: ${error.message}`);
          }
          resolved++;
        }
        // else: hasn't hit the line yet, and the day isn't over -- too early to call it.
      } else {
        throw new Error(`title matched neither rain nor temp pattern: "${market.title}"`);
      }
    } catch (err) {
      failed++;
      await recordFailure(market.id, err);
    }
  }

  const { error: pruneErr } = await admin.rpc('_prune_resolved_system_markets');
  if (pruneErr) console.error('_prune_resolved_system_markets failed:', pruneErr.message);

  await admin.rpc('_record_pipeline_run', { p_pipeline: 'weather', p_job: 'resolve', p_succeeded: resolved, p_failed: failed });

  return new Response(JSON.stringify({ resolved, failed }), { status: 200, headers: { 'Content-Type': 'application/json' } });
});
