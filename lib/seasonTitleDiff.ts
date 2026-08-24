import { TITLE_ORDER, TITLE_META, type TitleKey } from '@/lib/titles';

/** The shape `season_results.snapshot.titles_snapshot` stores (see the finalize-season
 * migration, supabase/migrations/20260823140000_season_end_stats_and_title_snapshot.sql). */
export interface TitleSnapshotEntry {
  title_key: string;
  user_id: string | null;
  nickname: string | null;
  stat_value: number | null;
}

export interface TitleChange {
  titleKey: TitleKey;
  label: string;
  toUserId: string;
  toNickname: string;
  fromUserId: string | null;
  fromNickname: string | null;
}

/**
 * Compares the titles a group's members hold right now (or at the moment a season just
 * closed — the two are the same during intermission, since nothing re-resolves until the next
 * season starts) against `prior`, the titles_snapshot captured when the *previous* season
 * ended. That's "who held what at the start of the season that just finished," which is what
 * makes a title's new holder — or its loss — attributable to this season specifically, without
 * titles themselves ever becoming season-scoped.
 *
 * `prior` is null for a group's first-ever season end (nothing to diff against yet) — every
 * caller treats that as "no changes," not an error.
 */
export function diffTitleSnapshots(current: TitleSnapshotEntry[], prior: TitleSnapshotEntry[] | null): TitleChange[] {
  if (!prior) return [];
  const priorByKey = new Map(prior.map((r) => [r.title_key, r]));
  const changes: TitleChange[] = [];
  for (const key of TITLE_ORDER) {
    const cur = current.find((r) => r.title_key === key);
    if (!cur?.user_id || !cur.nickname) continue; // vacant now — nothing to attribute
    const prev = priorByKey.get(key);
    if (prev?.user_id === cur.user_id) continue; // unchanged holder
    changes.push({
      titleKey: key,
      label: TITLE_META[key].label,
      toUserId: cur.user_id,
      toNickname: cur.nickname,
      fromUserId: prev?.user_id ?? null,
      fromNickname: prev?.nickname ?? null,
    });
  }
  return changes;
}
