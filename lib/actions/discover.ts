'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { runRpc, toActionError, friendlyMessage, type ActionResult } from '@/lib/errors';
import type { Membership } from '@/lib/actions/groups';

export interface PublicGroup {
  id: string;
  name: string;
  avatar_key: string | null;
  category: 'generic' | 'campus';
  member_count: number;
  open_market_count: number;
  /** The one open market worth surfacing on a directory card — soonest-closing first (see the
      function's own migration). Null when the group has nothing open right now. */
  featured_market_id: string | null;
  featured_market_title: string | null;
  /** A volume signal only — never a price. This app never reveals odds on a market that's still
      open (see ARCHITECTURE.md's "sealed odds" decision), and a directory card isn't an
      exception; a bet count carries none of that information the way a percentage would. */
  featured_market_bet_count: number;
}

/** The browse directory — a deliberately open read, gated server-side by is_public rather than
    membership (see list_public_groups()'s migration). Every signed-in user can call this
    regardless of what groups they're already in.

    Deliberately not routed through runRpc(): that helper unwraps a Postgres function's result
    down to result.data[0], which is correct for every other RPC in this app (each returns
    exactly one row) but wrong here — list_public_groups() returns a whole table of rows, and
    runRpc would silently collapse the directory down to a single group. */
export async function listPublicGroups(): Promise<ActionResult<PublicGroup[]>> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('list_public_groups');
  if (error) return { error: friendlyMessage(toActionError(error)) };
  return { data: (data ?? []) as PublicGroup[] };
}

/** The instant-join counterpart to joinGroup(), keyed by group id instead of an invite code —
    see join_public_group()'s migration for why no rate limiting applies here. */
export async function joinPublicGroup(groupId: string, nickname?: string): Promise<ActionResult<Membership>> {
  const supabase = await createClient();
  const result = await runRpc<Membership>(await supabase.rpc('join_public_group', { p_group_id: groupId, p_nickname: nickname ?? null }));
  if (result.error) return result;
  revalidatePath('/groups');
  return result;
}

/** A moderator's self-service step-down — lighter than leaving the group entirely. */
export async function forfeitModerator(groupId: string): Promise<ActionResult<Membership>> {
  const supabase = await createClient();
  const result = await runRpc<Membership>(await supabase.rpc('forfeit_moderator', { p_group_id: groupId }));
  if (result.error) return result;
  revalidatePath(`/groups/${groupId}/settings`);
  return result;
}
