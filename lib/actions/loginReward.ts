'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { runRpc, friendlyMessage, toActionError, type ActionResult } from '@/lib/errors';

/** One row of `get_login_reward_status()`'s `groups` array / one row returned by `claim_login_reward()`. */
export interface LoginRewardGroup {
  group_id: string;
  group_name: string;
  /** What a claim credits in this group right now. 0 means the owner has the reward turned off
      (or the default 5% of a tiny allocation floors to nothing). */
  amount: number;
}

/** The shape `get_login_reward_status()` returns (a single jsonb object). */
export interface LoginRewardStatus {
  current_streak: number;
  last_open_day: string | null;
  groups: LoginRewardGroup[];
}

/** Called from `RecordAppOpen` (mounted in the signed-in app shell) once per local day per
 * device. `localDay` is the browser's own calendar day as YYYY-MM-DD; the server clamps it to
 * within a day of its own UTC date and otherwise trusts it, since only the device knows whether a
 * 1am open belongs to tonight or tomorrow. Returns the streak as it now stands and whether this
 * call actually moved it, so the caller can refresh anything that shows the streak. */
export async function recordAppOpen(localDay: string): Promise<ActionResult<{ current_streak: number; changed: boolean }>> {
  const supabase = await createClient();
  return runRpc<{ current_streak: number; changed: boolean }>(await supabase.rpc('record_app_open', { p_local_day: localDay }));
}

/** The day-7 claim. Credits every active membership whose effective reward is above zero (one
 * `reward` ledger row each, same transaction as the balance change), resets the streak to 0, and
 * returns what was credited per group. A second call on the same run is refused by the function
 * ("no reward to claim yet"), so a double-tap can't pay twice. */
export async function claimLoginReward(): Promise<ActionResult<LoginRewardGroup[]>> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('claim_login_reward');
  // Not runRpc(): that unwraps a one-row array to its first row, which is exactly wrong for a
  // function whose whole result is a list. Same error mapping, rows kept as rows.
  if (error) return { error: friendlyMessage(toActionError(error)) };
  revalidatePath('/profile');
  revalidatePath('/groups');
  return { data: (data ?? []) as LoginRewardGroup[] };
}
