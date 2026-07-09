'use client';

import { useEffect, useState } from 'react';
import { friendlyTimezoneName } from '@/lib/timezone';

/**
 * Only mentions the group's reference time zone when it actually differs
 * from the visiting device's own zone — most groups are all in one time
 * zone, so the common case should say nothing extra at all.
 */
export function TimezoneCaption({ groupTimezone }: { groupTimezone: string }) {
  const [deviceTimezone, setDeviceTimezone] = useState<string | null>(null);
  useEffect(() => {
    try {
      setDeviceTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone);
    } catch {
      // stays null — render nothing rather than a guess
    }
  }, []);

  if (!deviceTimezone) return null;

  if (deviceTimezone === groupTimezone) {
    return <p className="text-xs text-espresso-400">Times shown in {friendlyTimezoneName(groupTimezone)}.</p>;
  }

  return (
    <p className="text-xs text-espresso-400">
      Times shown in {friendlyTimezoneName(deviceTimezone)}. Group's reference zone: {friendlyTimezoneName(groupTimezone)}.
    </p>
  );
}
