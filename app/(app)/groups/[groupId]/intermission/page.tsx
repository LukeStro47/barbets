import { createClient } from '@/lib/supabase/server';
import { notFoundIfEmpty } from '@/lib/errors';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { OptInButton, StartSeasonButton } from '@/components/groups/IntermissionActions';
import { Mention } from '@/components/ui/Mention';
import { formatTokens } from '@/lib/formatNumber';

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
        <div className="relative rounded-[28px] bg-gradient-to-br from-espresso-900 via-espresso-800 to-espresso-700 px-6 pt-7 pb-6 text-center text-paper-white shadow-lg shadow-espresso-950/25">
          <p className="text-[11.5px] font-bold tracking-[0.14em] text-honey-400 uppercase">Champion</p>
          <span className="mx-auto mt-4 flex h-[72px] w-[72px] -rotate-6 items-center justify-center rounded-full border-[3px] border-honey-500 bg-espresso-950 text-[28px] shadow-[0_8px_18px_-6px_rgba(232,163,61,0.55)]">
            🏆
          </span>
          <p className="mt-4 font-display text-2xl font-bold">
            <Mention nickname={lastResult.snapshot.champion.nickname} />
          </p>

          {/* Same perforated punch-hole divider as RevealTicket/the Hall of Fame recap —
              this callout is effectively a mini reveal ticket for the season itself. */}
          <div className="relative -mx-6 mt-5 border-t-2 border-dashed border-white/15">
            <span className="absolute top-1/2 -left-2.5 h-5 w-5 -translate-y-1/2 rounded-full bg-paper" />
            <span className="absolute top-1/2 -right-2.5 h-5 w-5 -translate-y-1/2 rounded-full bg-paper" />
          </div>

          <p className="mt-4 text-sm text-paper-white/70">
            Finished with <span className="font-bold tabular-nums text-honey-300">{formatTokens(lastResult.snapshot.champion.balance)}</span>{' '}
            tokens
          </p>
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
