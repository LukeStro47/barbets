import type { createClient } from '@/lib/supabase/server';
import type { InviteJoiner } from '@/components/groups/InviteScreen';

/**
 * 5m's "Who has used it": the most recent people to join, newest first. Every join into a
 * private group goes through its invite code (by link, QR, or typing it), so recent joiners are
 * exactly who has used it. `exclude` drops the owner and the viewer, who aren't news to anyone.
 */
export async function loadInviteJoiners(
  supabase: Awaited<ReturnType<typeof createClient>>,
  groupId: string,
  exclude: string[],
  limit = 5
): Promise<InviteJoiner[]> {
  const { data: rows } = await supabase
    .from('memberships')
    .select('user_id, nickname, joined_at')
    .eq('group_id', groupId)
    .in('status', ['active', 'dormant'])
    .order('joined_at', { ascending: false })
    .limit(limit + exclude.length);
  const joiners = (rows ?? []).filter((r) => !exclude.includes(r.user_id)).slice(0, limit);
  if (joiners.length === 0) return [];
  const { data: users } = await supabase.from('users').select('id, avatar_updated_at, avatar_preset_key').in('id', joiners.map((j) => j.user_id));
  return joiners.map((j) => {
    const u = (users ?? []).find((x) => x.id === j.user_id);
    return {
      userId: j.user_id,
      nickname: j.nickname ?? '',
      joinedAt: j.joined_at,
      avatarUpdatedAt: u?.avatar_updated_at ?? null,
      avatarPresetKey: u?.avatar_preset_key ?? null,
    };
  });
}
