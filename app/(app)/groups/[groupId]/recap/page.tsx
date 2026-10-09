import { createClient, requireUser } from '@/lib/supabase/server';
import { notFoundIfEmpty } from '@/lib/errors';
import { ScreenHeader } from '@/components/ui/Screen';
import { SeasonOver } from '@/components/groups/SeasonOver';
import { loadSeasonOver } from '@/lib/seasonOver';

/**
 * 5n for any ended season, reached from the season chips on 5n itself and from 4r's "Recent
 * seasons" rows. The season that just ended also renders on the group hub during intermission,
 * with the owner's next-season setup; this route is the read-only view of any of them.
 */
export default async function SeasonRecapPage({
  params,
  searchParams,
}: {
  params: Promise<{ groupId: string }>;
  searchParams: Promise<{ season?: string }>;
}) {
  const { groupId } = await params;
  const { season } = await searchParams;
  const supabase = await createClient();
  const user = await requireUser(supabase);

  const { data: group } = await supabase.from('groups').select('name, is_public').eq('id', groupId).single();
  notFoundIfEmpty(group);

  const data = await loadSeasonOver(supabase, groupId, user.id, season ? Number(season) : undefined);
  notFoundIfEmpty(data);

  const avatarIds = [...new Set([...data!.finalBalances.map((r) => r.user_id), ...(data!.champion ? [data!.champion.user_id] : [])])];
  const { data: avatarRows } =
    avatarIds.length > 0 && !group!.is_public
      ? await supabase.from('users').select('id, avatar_updated_at, avatar_preset_key').in('id', avatarIds)
      : { data: [] };

  return (
    <>
      <ScreenHeader title={data!.season.name} href={`/groups/${groupId}/leaderboard?lens=alltime`} />
      <main className="mx-auto max-w-[430px] px-[22px] pt-6 pb-10">
        <SeasonOver groupId={groupId} data={data!} viewerId={user.id} avatars={new Map((avatarRows ?? []).map((r) => [r.id, r]))} />
      </main>
    </>
  );
}
