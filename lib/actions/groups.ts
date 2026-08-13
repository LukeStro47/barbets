'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { runRpc, type ActionResult } from '@/lib/errors';
import { normalizeInviteCode } from '@/lib/inviteCode';

export interface Group {
  id: string;
  name: string;
  owner_id: string;
  invite_code: string;
  created_at: string;
  deletion_scheduled_at: string | null;
  /** One of lib/avatars.ts's GROUP_AVATARS keys, or null for the initials fallback. Stored as free text, so an unrecognized key degrades to initials rather than erroring. */
  avatar_key: string | null;
}

export interface Membership {
  id: string;
  group_id: string;
  user_id: string;
  balance: number;
  status: 'active' | 'dormant' | 'left' | 'removed';
  nickname: string;
  joined_at: string;
}

export async function createGroup(input: {
  name: string;
  seedAmount: number;
  seasonsEnabled: boolean;
  seasonLength: '1m' | '2m' | '3m' | 'manual' | 'custom' | null;
  seasonCustomEndsAt?: string | null;
  nickname: string;
  timezone: string;
}): Promise<ActionResult<Group>> {
  const supabase = await createClient();
  const result = await runRpc<Group>(
    await supabase.rpc('create_group', {
      p_name: input.name,
      p_seed_amount: input.seedAmount,
      p_seasons_enabled: input.seasonsEnabled,
      p_season_length: input.seasonLength,
      p_nickname: input.nickname,
      p_timezone: input.timezone,
      p_season_custom_ends_at: input.seasonCustomEndsAt ?? null,
    })
  );
  if (result.error) return result;
  revalidatePath('/groups');
  return result;
}

export async function joinGroup(inviteCode: string, nickname?: string): Promise<ActionResult<Membership>> {
  const supabase = await createClient();
  // Every join in the app funnels through here, so this is where a code still carrying the retired
  // "BB-" prefix (a printed card, an old shared link) gets cleaned up — join_group() itself only
  // ever sees the stored 4-character form.
  const result = await runRpc<Membership>(
    await supabase.rpc('join_group', { p_invite_code: normalizeInviteCode(inviteCode), p_nickname: nickname ?? null })
  );
  if (result.error) return result;
  // A code that matches no group comes back as zero rows rather than a raise: join_group has to
  // record the miss for the invite-code rate limit, and a raise would roll that write back with
  // the rest of the transaction (see 20260813130000_invite_code_rate_limit.sql, and its
  // 20260813150000 correction for why zero rows rather than a null row). The friendly copy that
  // raise used to produce is re-created here instead.
  if (!result.data) return { error: "That invite code doesn't match a group." };
  revalidatePath('/groups');
  return result;
}

export async function renameGroup(groupId: string, name: string): Promise<ActionResult<Group>> {
  const supabase = await createClient();
  const result = await runRpc<Group>(await supabase.rpc('rename_group', { p_group_id: groupId, p_name: name }));
  if (result.error) return result;
  revalidatePath(`/groups/${groupId}`);
  revalidatePath(`/groups/${groupId}/settings`);
  revalidatePath('/groups');
  return result;
}

/** Pass null to clear it back to the group's initials. */
export async function setGroupAvatar(groupId: string, avatarKey: string | null): Promise<ActionResult<Group>> {
  const supabase = await createClient();
  const result = await runRpc<Group>(await supabase.rpc('set_group_avatar', { p_group_id: groupId, p_avatar_key: avatarKey }));
  if (result.error) return result;
  revalidatePath(`/groups/${groupId}`);
  revalidatePath(`/groups/${groupId}/settings`);
  revalidatePath('/groups');
  revalidatePath('/profile');
  return result;
}

export async function updateNickname(groupId: string, nickname: string): Promise<ActionResult<Membership>> {
  const supabase = await createClient();
  const result = await runRpc<Membership>(
    await supabase.rpc('update_nickname', { p_group_id: groupId, p_nickname: nickname })
  );
  if (result.error) return result;
  revalidatePath(`/groups/${groupId}`);
  return result;
}

export async function removeMember(groupId: string, targetUserId: string): Promise<ActionResult<null>> {
  const supabase = await createClient();
  const result = await runRpc<null>(await supabase.rpc('remove_member', { p_group_id: groupId, p_target_user_id: targetUserId }));
  if (result.error) return result;
  revalidatePath(`/groups/${groupId}/settings`);
  return result;
}

export interface GroupSettings {
  group_id: string;
  seed_amount: number;
  seasons_enabled: boolean;
  season_length: '1m' | '2m' | '3m' | 'manual' | 'custom' | null;
  season_custom_ends_at: string | null;
  timezone: string;
  betting_enabled: boolean;
  accepting_members: boolean;
  distribute_payout: boolean;
  creator_payout_pct: number;
  allow_hedged_bets: boolean;
  /** Shared by the challenge window (propose -> dispute) and the vote window (dispute -> finalize), in half-hour steps between 0.5 and 10. */
  resolution_window_hours: number;
  /** Default true. When false, create_market() opens a market directly instead of routing it through pending_sponsor. */
  require_endorsement: boolean;
}

export async function updateGroupSettings(
  groupId: string,
  input: {
    seedAmount: number;
    seasonsEnabled: boolean;
    seasonLength: GroupSettings['season_length'];
    seasonCustomEndsAt?: string | null;
    timezone: string;
    bettingEnabled: boolean;
    acceptingMembers: boolean;
    distributePayout: boolean;
    creatorPayoutPct: number;
    allowHedgedBets: boolean;
    resolutionWindowHours: number;
    requireEndorsement: boolean;
  }
): Promise<ActionResult<GroupSettings>> {
  const supabase = await createClient();
  const result = await runRpc<GroupSettings>(
    await supabase.rpc('update_group_settings', {
      p_group_id: groupId,
      p_seed_amount: input.seedAmount,
      p_seasons_enabled: input.seasonsEnabled,
      p_season_length: input.seasonLength,
      p_timezone: input.timezone,
      p_betting_enabled: input.bettingEnabled,
      p_accepting_members: input.acceptingMembers,
      p_distribute_payout: input.distributePayout,
      p_creator_payout_pct: input.creatorPayoutPct,
      p_allow_hedged_bets: input.allowHedgedBets,
      p_season_custom_ends_at: input.seasonCustomEndsAt ?? null,
      p_resolution_window_hours: input.resolutionWindowHours,
      p_require_endorsement: input.requireEndorsement,
    })
  );
  if (result.error) return result;
  revalidatePath(`/groups/${groupId}/settings`);
  revalidatePath(`/groups/${groupId}`);
  return result;
}

export async function transferOwnership(groupId: string, newOwnerUserId: string): Promise<ActionResult<Group>> {
  const supabase = await createClient();
  const result = await runRpc<Group>(
    await supabase.rpc('transfer_ownership', { p_group_id: groupId, p_new_owner_id: newOwnerUserId })
  );
  if (result.error) return result;
  revalidatePath(`/groups/${groupId}/settings`);
  revalidatePath(`/groups/${groupId}`);
  return result;
}

/** No longer deletes anything immediately — voids and refunds every open market, then schedules the actual removal 5 days out. */
export async function deleteGroup(groupId: string): Promise<ActionResult<Group>> {
  const supabase = await createClient();
  const result = await runRpc<Group>(await supabase.rpc('delete_group', { p_group_id: groupId }));
  if (result.error) return result;
  revalidatePath(`/groups/${groupId}`);
  revalidatePath(`/groups/${groupId}/settings`);
  revalidatePath('/groups');
  return result;
}

export async function cancelGroupDeletion(groupId: string): Promise<ActionResult<Group>> {
  const supabase = await createClient();
  const result = await runRpc<Group>(await supabase.rpc('cancel_group_deletion', { p_group_id: groupId }));
  if (result.error) return result;
  revalidatePath(`/groups/${groupId}`);
  revalidatePath(`/groups/${groupId}/settings`);
  return result;
}

export async function regenerateInviteCode(groupId: string): Promise<ActionResult<Group>> {
  const supabase = await createClient();
  const result = await runRpc<Group>(await supabase.rpc('regenerate_invite_code', { p_group_id: groupId }));
  if (result.error) return result;
  revalidatePath(`/groups/${groupId}/settings`);
  revalidatePath(`/groups/${groupId}`);
  return result;
}

export async function leaveGroup(groupId: string): Promise<ActionResult<null>> {
  const supabase = await createClient();
  const result = await runRpc<null>(await supabase.rpc('leave_group', { p_group_id: groupId }));
  if (result.error) return result;
  revalidatePath('/groups');
  return result;
}
