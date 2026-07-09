import { createClient } from '@/lib/supabase/server';
import { notFoundIfEmpty } from '@/lib/errors';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { OptInButton, StartSeasonButton } from '@/components/groups/IntermissionActions';
import { Mention } from '@/components/ui/Mention';

export default async function IntermissionPage({ params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await params;
  const supabase = await createClient();

  const { data: group } = await supabase.from('groups').select('id, name, owner_id').eq('id', groupId).single();
  notFoundIfEmpty(group);

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: season } = await supabase
    .from('seasons')
    .select('id, number')
    .eq('group_id', groupId)
    .eq('status', 'intermission')
    .single();
  notFoundIfEmpty(season);

  const { data: lastResult } = await supabase
    .from('season_results')
    .select('snapshot')
    .eq('group_id', groupId)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  const { data: optins } = await supabase.from('season_optins').select('user_id').eq('season_id', season!.id);

  const optinUserIds = (optins ?? []).map((o) => o.user_id);
  const { data: optinMembers } =
    optinUserIds.length > 0
      ? await supabase.from('memberships').select('user_id, nickname').eq('group_id', groupId).in('user_id', optinUserIds)
      : { data: [] };
  const nicknameByUserId = new Map((optinMembers ?? []).map((m) => [m.user_id, m.nickname]));

  const iAmIn = (optins ?? []).some((o: any) => o.user_id === user?.id);
  const isOwner = group!.owner_id === user?.id;

  return (
    <main className="mx-auto max-w-lg space-y-6 px-5 py-8">
      <PageHeader title={`Season ${season!.number - 1} is over`} backHref={`/groups/${groupId}`} backLabel="Group" />

      {lastResult?.snapshot.champion && (
        <div className="rounded-3xl bg-espresso-900 px-6 py-8 text-center text-paper-white">
          <p className="text-sm font-medium uppercase tracking-widest text-honey-400">Champion</p>
          <p className="mt-2 font-display text-3xl font-bold">
            🏆 <Mention nickname={lastResult.snapshot.champion.nickname} />
          </p>
          <p className="mt-1 text-espresso-200">Finished with {lastResult.snapshot.champion.balance} tokens</p>
        </div>
      )}

      <Card className="space-y-3">
        <h2 className="font-display font-bold text-espresso-800">Run it back? Who's in?</h2>
        <ul className="flex flex-wrap gap-2">
          {(optins ?? []).map((o: any) => (
            <li key={o.user_id} className="rounded-full bg-honey-100 px-3 py-1 text-sm font-semibold text-honey-800">
              <Mention nickname={nicknameByUserId.get(o.user_id) ?? ''} />
            </li>
          ))}
          {(optins ?? []).length === 0 && <li className="text-sm text-espresso-400">Nobody yet. Be the first.</li>}
        </ul>
        <OptInButton groupId={groupId} seasonId={season!.id} alreadyIn={iAmIn} />
      </Card>

      {isOwner && (
        <Card>
          <p className="mb-3 text-sm text-espresso-500">Starting reseeds everyone who's opted in. Whenever you're ready.</p>
          <StartSeasonButton groupId={groupId} optInCount={(optins ?? []).length} />
        </Card>
      )}
    </main>
  );
}
