import { createClient, requireUser } from '@/lib/supabase/server';
import { notFoundIfEmpty } from '@/lib/errors';
import type { GroupSettings } from '@/lib/actions/groups';
import type { ActiveSeasonSummary, GroupManageContext, RosterRow } from '@/lib/groupManage';

/** Server-only: cookies()/next/headers. Do not import this from a client component. */
export async function loadGroupManageContext(groupId: string): Promise<GroupManageContext> {
  const supabase = await createClient();

  const { data: group } = await supabase
    .from('groups')
    .select('id, name, avatar_key, invite_code, owner_id, deletion_scheduled_at, is_public')
    .eq('id', groupId)
    .single();
  notFoundIfEmpty(group);

  const user = await requireUser(supabase);
  const isOwner = group!.owner_id === user.id;
  const isPublic = group!.is_public;

  const [{ data: settings }, { data: members }, { data: myMembership }, { data: activeSeasonRow }] = await Promise.all([
    supabase.from('group_settings').select('*').eq('group_id', groupId).single(),
    supabase.from('memberships').select('id, user_id, status, nickname, role').eq('group_id', groupId).in('status', ['active', 'dormant']),
    supabase.from('memberships').select('nickname, role').eq('group_id', groupId).eq('user_id', user.id).single(),
    supabase.from('seasons').select('id, number, name, betting_open').eq('group_id', groupId).eq('status', 'active').single(),
  ]);

  const isModerator = myMembership?.role === 'moderator';
  const season: ActiveSeasonSummary | null = activeSeasonRow
    ? { number: activeSeasonRow.number, name: activeSeasonRow.name, bettingOpen: activeSeasonRow.betting_open }
    : null;

  return {
    groupId,
    group: group!,
    userId: user.id,
    isOwner,
    isPublic,
    isModerator,
    canBan: isOwner || (isPublic && isModerator),
    canEditSettings: isOwner || (isPublic && isModerator),
    settings: (settings as GroupSettings | null) ?? null,
    season,
    activeSeasonRow: activeSeasonRow ? { id: activeSeasonRow.id, number: activeSeasonRow.number, name: activeSeasonRow.name } : null,
    roster: (members as RosterRow[] | null) ?? [],
    myMembership: myMembership ?? null,
    roleLabel: isOwner ? 'Owner' : isModerator ? 'Moderator' : null,
  };
}
