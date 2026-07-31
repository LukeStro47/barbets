/** Last-known, read-only group balances for the offline page (app/offline/page.tsx).
    Deliberately the only piece of app data cached client-side — see public/sw.js's
    header comment on why live odds/bet state never get this treatment. A balance
    here can be minutes or days stale; the offline page labels it as such and this
    is never read by anything that places a bet or shows live odds. */

const STORAGE_KEY = 'barbets:group-balances';

export type GroupBalanceSnapshot = {
  groupId: string;
  groupName: string;
  balance: number;
  savedAt: string;
};

function readAll(): Record<string, GroupBalanceSnapshot> {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function saveGroupBalanceSnapshot(snapshot: Omit<GroupBalanceSnapshot, 'savedAt'>): void {
  try {
    const all = readAll();
    all[snapshot.groupId] = { ...snapshot, savedAt: new Date().toISOString() };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    // Storage full/disabled — the snapshot is a nice-to-have, never worth surfacing an error for.
  }
}

export function getGroupBalanceSnapshots(): GroupBalanceSnapshot[] {
  return Object.values(readAll()).sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}
