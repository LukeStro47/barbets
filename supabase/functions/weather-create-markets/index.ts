// Morning job: creates a "will it rain" and a "will it hit X°F" market per city in CITIES,
// closing at the end of the day's forecast period, in the seeded "Weather" public group. Free,
// keyless, U.S. federal public-domain data (api.weather.gov). Checked in against
// pipeline_settings before doing anything, same as weather-resolve-markets and both sports
// functions -- see the admin console's pipeline toggle.
//
// No shared metadata table linking a market back to its city/station: weather-resolve-markets
// re-derives the city from the market's title (title format is fixed and only ever produced by
// this function) and looks it up in its own copy of CITIES. Same "no shared folder, each
// function is self-contained" convention send-push already established for this project.
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

// Daily highs are typically reached mid-afternoon, well before a forecast period's own endTime
// (NWS "Today" periods commonly run until 18:00 local) -- a temperature market that stayed open
// that long was betting on an already-decided outcome for hours. 5pm local is a deliberately
// simple approximation, not a per-city climatological cutoff; the rain market keeps using the
// forecast period's actual endTime, since rain can happen any time through the day.
const TEMP_MARKET_CLOSE_HOUR_LOCAL = 17;

interface ForecastPeriod {
  name: string;
  endTime: string;
  temperature: number;
  shortForecast: string;
}

async function nwsFetch(url: string): Promise<any> {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/geo+json' } });
  if (!res.ok) throw new Error(`NWS request failed (${res.status}): ${url}`);
  return res.json();
}

/** The UTC instant for `hour`:00 local wall-clock time, today, in `timeZone` -- handles DST
    correctly with no timezone library. "Today" is read from `timeZone` itself, not from UTC's
    own date, since those can disagree depending on what time this happens to run. Standard trick
    for the hour itself: format an initial UTC guess back through the target zone, then correct
    by however far off that reading is from the guess. */
function localHourTodayToUtcIso(timeZone: string, hour: number): string {
  const now = new Date();
  const dateFmt = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
  const dateParts = Object.fromEntries(dateFmt.formatToParts(now).map((p) => [p.type, p.value]));
  const guess = new Date(Date.UTC(Number(dateParts.year), Number(dateParts.month) - 1, Number(dateParts.day), hour, 0, 0));
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

/** Deterministic, not random -- sweep_failures upserts on (sweep, subject_id), so the same
    logical failure (same city, same day) needs to hash to the same id across retries or every
    run looks like a brand new failure and the attempt counter never climbs. */
async function stableId(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  const bytes = new Uint8Array(digest).slice(0, 16);
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

async function recordFailure(subject: string, err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  const { error } = await admin.rpc('_record_sweep_failure', {
    p_sweep: 'weather_market_create',
    p_subject_id: await stableId(subject),
    p_sqlstate: 'EDGEFN',
    p_message: message,
    p_context: err instanceof Error ? (err.stack ?? null) : null,
  });
  if (error) console.error(`recordFailure itself failed for ${subject}:`, error.message);
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

  let created = 0;
  let failed = 0;

  for (const city of CITIES) {
    try {
      const point = await nwsFetch(`https://api.weather.gov/points/${city.lat},${city.lon}`);
      const forecast = await nwsFetch(point.properties.forecast);
      const period: ForecastPeriod = forecast.properties.periods[0];
      const timeZone: string = point.properties.timeZone;

      const rainTitle = `Will it rain in ${city.name} today?`;
      const rainClosesAt = period.endTime;

      const tempTitle = `Will ${city.name} hit ${period.temperature}°F today?`;
      const tempClosesAt = localHourTodayToUtcIso(timeZone, TEMP_MARKET_CLOSE_HOUR_LOCAL);

      const { data: existing } = await admin
        .from('markets')
        .select('id, title, closes_at')
        .eq('group_id', group.id)
        .in('title', [rainTitle, tempTitle]);
      const existingByTitleAndClose = new Set((existing ?? []).map((m: { title: string; closes_at: string }) => `${m.title}|${m.closes_at}`));

      if (!existingByTitleAndClose.has(`${rainTitle}|${rainClosesAt}`)) {
        const { error } = await admin.rpc('_create_system_market', {
          p_group_id: group.id,
          p_title: rainTitle,
          p_description: `Auto-generated from the National Weather Service forecast for ${city.name}: "${period.shortForecast}."`,
          p_market_type: 'yes_no',
          p_closes_at: rainClosesAt,
        });
        if (error) throw new Error(`rain market: ${error.message}`);
        created++;
      }

      // Only created if tempClosesAt is still in the future -- close enough to "now" (e.g. a
      // late/retried run) that a 5pm-local cutoff has already passed shouldn't create a market
      // that would fail create_market's own "closes_at must be in the future" check.
      if (new Date(tempClosesAt).getTime() > Date.now() && !existingByTitleAndClose.has(`${tempTitle}|${tempClosesAt}`)) {
        const { error } = await admin.rpc('_create_system_market', {
          p_group_id: group.id,
          p_title: tempTitle,
          p_description: `Auto-generated from the National Weather Service forecast for ${city.name}, which called for a high of ${period.temperature}°F. Closes at 5pm local, around when the day's high is typically reached.`,
          p_market_type: 'over_under',
          p_closes_at: tempClosesAt,
          p_line: period.temperature,
          p_unit: '°F',
        });
        if (error) throw new Error(`temp market: ${error.message}`);
        created++;
      }
    } catch (err) {
      failed++;
      await recordFailure(`${city.name}-${new Date().toISOString().slice(0, 10)}`, err);
    }
  }

  await admin.rpc('_record_pipeline_run', { p_pipeline: 'weather', p_job: 'create', p_succeeded: created, p_failed: failed });

  return new Response(JSON.stringify({ created, failed }), { status: 200, headers: { 'Content-Type': 'application/json' } });
});
