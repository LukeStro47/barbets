'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { runRpc, type ActionResult } from '@/lib/errors';

export interface Group {
  id: string;
  name: string;
  owner_id: string;
  invite_code: string;
  created_at: string;
}

export interface Membership {
  id: string;
  group_id: string;
  user_id: string;
  balance: number;
  status: 'active' | 'dormant' | 'removed';
  nickname: string;
  joined_at: string;
}

export async function createGroup(input: {
  name: string;
  seedAmount: number;
  seasonsEnabled: boolean;
  seasonLength: '1m' | '2m' | '3m' | 'manual' | null;
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
    })
  );
  if (result.error) return result;
  revalidatePath('/groups');
  return result;
}

export async function joinGroup(inviteCode: string, nickname?: string): Promise<ActionResult<Membership>> {
  const supabase = await createClient();
  const result = await runRpc<Membership>(
    await supabase.rpc('join_group', { p_invite_code: inviteCode, p_nickname: nickname ?? null })
  );
  if (result.error) return result;
  revalidatePath('/groups');
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
  season_length: '1m' | '2m' | '3m' | 'manual' | null;
  timezone: string;
  betting_enabled: boolean;
  accepting_members: boolean;
  distribute_payout: boolean;
  creator_payout_pct: number;
  endorser_payout_pct: number;
}

export async function updateGroupSettings(
  groupId: string,
  input: {
    seedAmount: number;
    seasonsEnabled: boolean;
    seasonLength: GroupSettings['season_length'];
    timezone: string;
    bettingEnabled: boolean;
    acceptingMembers: boolean;
    distributePayout: boolean;
    creatorPayoutPct: number;
    endorserPayoutPct: number;
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
      p_endorser_payout_pct: input.endorserPayoutPct,
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

export async function deleteGroup(groupId: string): Promise<ActionResult<null>> {
  const supabase = await createClient();
  const result = await runRpc<null>(await supabase.rpc('delete_group', { p_group_id: groupId }));
  if (result.error) return result;
  revalidatePath('/groups');
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
