const FRIENDLY_NAMES: Record<string, string> = {
  'America/New_York': 'Eastern time',
  'America/Chicago': 'Central time',
  'America/Denver': 'Mountain time',
  'America/Phoenix': 'Arizona time',
  'America/Los_Angeles': 'Pacific time',
  'America/Anchorage': 'Alaska time',
  'Pacific/Honolulu': 'Hawaii time',
  'Europe/London': 'UK time',
  UTC: 'UTC',
};

/** Falls back to the city segment of the IANA name (e.g. "America/Sao_Paulo" -> "Sao Paulo time") for zones without a common-name mapping. */
export function friendlyTimezoneName(iana: string): string {
  if (FRIENDLY_NAMES[iana]) return FRIENDLY_NAMES[iana];
  const city = iana.split('/').pop() ?? iana;
  return `${city.replace(/_/g, ' ')} time`;
}

/**
 * A short, curated list instead of the full ~400-zone IANA set — picking a
 * time zone should take one scroll, not a search. Covers the continental US
 * (with Arizona split out since it doesn't observe DST), the other two US
 * time zones, and a handful of the most common zones elsewhere. Anyone in a
 * zone not listed here can still fall back to UTC; this isn't meant to be
 * exhaustive, just fast for the common case.
 */
export const COMMON_TIMEZONES = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Phoenix',
  'America/Los_Angeles',
  'America/Anchorage',
  'Pacific/Honolulu',
  'America/Sao_Paulo',
  'UTC',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Africa/Cairo',
  'Asia/Dubai',
  'Asia/Kolkata',
  'Asia/Shanghai',
  'Asia/Tokyo',
  'Australia/Sydney',
  'Pacific/Auckland',
] as const;
