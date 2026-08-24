'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { runRpc, toActionError, friendlyMessage, type ActionResult } from '@/lib/errors';
import type { Group } from '@/lib/actions/groups';

export async function sendAdminBroadcast(
  groupId: string,
  title: string,
  body: string,
  targetUserId: string | null
): Promise<ActionResult<null>> {
  const supabase = await createClient();
  return runRpc<null>(
    await supabase.rpc('send_admin_broadcast', { p_group_id: groupId, p_title: title, p_body: body, p_target_user_id: targetUserId })
  );
}

export interface CreatePublicGroupResult extends Group {
  /** Any moderator email that didn't match an existing Barbets account — the admin console shows
      these back so the admin knows who to follow up with separately. */
  unresolved_emails: string[];
}

/** Admin-only: spins up a new always-on public group, staff (the calling admin) as owner. Forced
    is_public/awards_enabled/seasons-off/no-hedging/no-endorsement server-side — see
    create_public_group()'s migration. A nickname is optional: passing one is the explicit "I'll
    moderate this group too" opt-in (it makes the admin a seeded, active, role='moderator' member
    alongside their existing owner authority); leaving it out means the admin manages the group
    purely from here, with no membership of their own. moderatorEmails adds each matching Barbets
    account directly as an active, seeded moderator, no join step. */
export async function createPublicGroup(input: {
  name: string;
  category: 'generic' | 'campus';
  seedAmount: number;
  timezone: string;
  nickname?: string | null;
  moderatorEmails?: string[];
}): Promise<ActionResult<CreatePublicGroupResult>> {
  const supabase = await createClient();
  const result = await runRpc<CreatePublicGroupResult>(
    await supabase.rpc('create_public_group', {
      p_name: input.name,
      p_category: input.category,
      p_seed_amount: input.seedAmount,
      p_timezone: input.timezone,
      p_nickname: input.nickname ?? null,
      p_moderator_emails: input.moderatorEmails ?? [],
    })
  );
  if (result.error) return result;
  revalidatePath('/admin');
  revalidatePath('/groups/discover');
  return result;
}

export interface ModeratorCandidate {
  user_id: string;
  nickname: string;
  role: 'member' | 'moderator';
}

/** Admin-only: every active/dormant member of a public group plus their current role, the picker
    behind assignGroupModerator().

    Not routed through runRpc(): it unwraps a result down to its first row, which is right for
    every single-row RPC in this app but wrong for a table-returning one like this — see
    listPublicGroups()'s identical note in lib/actions/discover.ts. */
export async function listGroupModeratorCandidates(groupId: string): Promise<ActionResult<ModeratorCandidate[]>> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('list_group_moderator_candidates', { p_group_id: groupId });
  if (error) return { error: friendlyMessage(toActionError(error)) };
  return { data: (data ?? []) as ModeratorCandidate[] };
}

/** Admin-only: flips a public-group member's moderator status. Scoped to public groups — a
    private group's owner already has full authority on their own. */
export async function assignGroupModerator(groupId: string, targetUserId: string, isModerator: boolean): Promise<ActionResult<null>> {
  const supabase = await createClient();
  const result = await runRpc<null>(
    await supabase.rpc('assign_group_moderator', { p_group_id: groupId, p_target_user_id: targetUserId, p_is_moderator: isModerator })
  );
  if (result.error) return result;
  revalidatePath('/admin');
  return result;
}
