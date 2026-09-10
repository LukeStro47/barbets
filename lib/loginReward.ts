/** The 7-day login reward's shared constants and pure helpers (GitHub #92). The server is the
    authority on every one of these -- `_login_reward_amount()` in Postgres is the formula that
    actually pays -- but the settings form and the read-only settings card need the same numbers
    to say what a blank field would credit. Keep the two in step. */

/** Consecutive local days needed before a claim opens up. */
export const LOGIN_STREAK_TARGET = 7;

/** What a group with `login_reward_amount = null` pays: this percentage of `seed_amount`, floored. */
export const LOGIN_REWARD_DEFAULT_PCT = 5;

/** Ceiling on an explicit per-group reward, same scale as the token allocation itself. */
export const LOGIN_REWARD_MAX = 1_000_000;

/** Mirrors `_login_reward_amount()`: integer arithmetic, so 100 -> 5, 1,000 -> 50, 15 -> 0. */
export function defaultLoginReward(seedAmount: number): number {
  return Math.floor((seedAmount * LOGIN_REWARD_DEFAULT_PCT) / 100);
}

/** The figure a claim would actually credit for a group: the owner's explicit amount, or the
    default when they've left it blank. 0 means the reward is off for that group. */
export function effectiveLoginReward(settings: { seed_amount: number; login_reward_amount: number | null }): number {
  return settings.login_reward_amount ?? defaultLoginReward(settings.seed_amount);
}

/** localStorage key holding the last local day (YYYY-MM-DD) this browser reported to
    `record_app_open`. Dedupes the call to one per day per device; the server dedupes again. */
export const APP_OPEN_DAY_STORAGE_KEY = 'barbets:app-open-day';

/** The browser's own calendar day as YYYY-MM-DD, in local time rather than UTC -- the whole
    point of the client reporting the day is that a 1am open still belongs to the night before
    for the person opening it, and only the device knows which day that is. */
export function localDayString(date: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
