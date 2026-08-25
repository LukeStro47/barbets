// Afternoon/evening job: resolves every weather-create-markets market whose closes_at has
// passed, against the nearest station's latest observation. Re-derives which city (and which
// kind of market) from the title text weather-create-markets generates -- see that function's
// header comment for why there's no separate metadata table.
//
// Simplifications worth knowing about: "did it rain" is read off the latest observation's
// textDescription (contains "Rain"/"Shower"/"Drizzle") rather than an accumulated precipitation
// total, since ASOS stations don't reliably report precipitation amounts; "hit X°F" compares the
// latest observation against the line rather than tracking the day's actual max, since that would
// need polling observations all day rather than once at resolve time. Both are fine for a v1 and
// worth revisiting if the market ever needs to be more exact than "close enough to bet on."
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

async function latestObservation(city: { lat: number; lon: number }): Promise<{ tempF: number | null; textDescription: string }> {
  const point = await nwsFetch(`https://api.weather.gov/points/${city.lat},${city.lon}`);
  const stations = await nwsFetch(point.properties.observationStations);
  const stationId = stations.features[0].properties.stationIdentifier;
  const obs = await nwsFetch(`https://api.weather.gov/stations/${stationId}/observations/latest`);
  const tempC = obs.properties.temperature.value;
  return {
    tempF: tempC === null ? null : Math.round((tempC * 9) / 5 + 32),
    textDescription: obs.properties.textDescription ?? '',
  };
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
    .select('id, title, market_type, line')
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

      const obs = await latestObservation(city);

      if (rainMatch) {
        const rained = /rain|shower|drizzle/i.test(obs.textDescription);
        const { error } = await admin.rpc('_resolve_system_market', {
          p_market_id: market.id,
          p_outcome: rained ? 'yes' : 'no',
        });
        if (error) throw new Error(`resolve rain market: ${error.message}`);
        resolved++;
      } else if (tempMatch) {
        if (obs.tempF === null) throw new Error('station has no current temperature reading');
        const { error } = await admin.rpc('_resolve_system_market', {
          p_market_id: market.id,
          p_outcome: obs.tempF >= market.line ? 'over' : 'under',
          p_actual_value: obs.tempF,
        });
        if (error) throw new Error(`resolve temp market: ${error.message}`);
        resolved++;
      } else {
        throw new Error(`title matched neither rain nor temp pattern: "${market.title}"`);
      }
    } catch (err) {
      failed++;
      await recordFailure(market.id, err);
    }
  }

  return new Response(JSON.stringify({ resolved, failed }), { status: 200, headers: { 'Content-Type': 'application/json' } });
});
