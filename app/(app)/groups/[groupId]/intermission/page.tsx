import { createClient } from '@/lib/supabase/server';
import { notFoundIfEmpty } from '@/lib/errors';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { RosterControl, ContinueButton } from '@/components/groups/IntermissionActions';
import { GroupDeletionBanner } from '@/components/groups/GroupDeletionBanner';
import { SeasonNameEditor } from '@/components/groups/SeasonNameEditor';
import { Mention } from '@/components/ui/Mention';
import { formatTokens } from '@/lib/formatNumber';

/** A group that's sat in intermission this long with nobody continuing gets auto-scheduled for deletion, mirroring delete_group's grace period. */
const INACTIVITY_DEADLINE_DAYS = 30;

function daysUntil(iso: string): number {
  return Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000));
}

export default async function IntermissionPage({ params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await params;
  const supabase = await createClient();

  const { data: group } = await supabase
    .from('groups')
    .select('id, name, owner_id, deletion_scheduled_at')
    .eq('id', groupId)
    .single();
  notFoundIfEmpty(group);

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: season } = await supabase
    .from('seasons')
    .select('id, number, name, started_at')
    .eq('group_id', groupId)
    .eq('status', 'intermission')
    .single();
  notFoundIfEmpty(season);

  const [{ data: lastResult }, { data: members }, { data: optouts }, { data: optins }] = await Promise.all([
    supabase.from('season_results').select('snapshot').eq('group_id', groupId).order('created_at', { ascending: false }).limit(1).single(),
    supabase.from('memberships').select('user_id, nickname, status').eq('group_id', groupId).neq('status', 'removed'),
    supabase.from('season_optouts').select('user_id').eq('season_id', season!.id),
    supabase.from('season_optins').select('user_id').eq('season_id', season!.id),
  ]);

  const optedOutIds = new Set((optouts ?? []).map((o) => o.user_id));
  const optedInIds = new Set((optins ?? []).map((o) => o.user_id));

  const playing = (members ?? []).filter(
    (m) => (m.status === 'active' && !optedOutIds.has(m.user_id)) || (m.status === 'dormant' && optedInIds.has(m.user_id))
  );
  const sittingOut = (members ?? []).filter((m) => !playing.some((p) => p.user_id === m.user_id));

  const isOwner = group!.owner_id === user?.id;
  const inactivityDeadline = new Date(new Date(season!.started_at).getTime() + INACTIVITY_DEADLINE_DAYS * 86_400_000).toISOString();
  const daysUntilInactivityDeletion = daysUntil(inactivityDeadline);

  return (
    <main className="mx-auto max-w-lg space-y-6 px-5 py-8">
      <PageHeader title={season!.name ?? `Season ${season!.number - 1} is over`} backHref={`/groups/${groupId}`} backLabel="Group" />

      {group!.deletion_scheduled_at ? (
        <GroupDeletionBanner groupId={groupId} deletionScheduledAt={group!.deletion_scheduled_at} isOwner={isOwner} />
      ) : (
        <p className="text-center text-xs text-espresso-400">
          If nobody continues within {daysUntilInactivityDeletion} day{daysUntilInactivityDeletion === 1 ? '' : 's'}, this group will be
          scheduled for deletion.
        </p>
      )}

      {isOwner && <SeasonNameEditor groupId={groupId} seasonId={season!.id} currentName={season!.name} />}

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
        <h2 className="font-display font-bold text-espresso-800">Who's playing next?</h2>
        <p className="text-xs text-espresso-400">Everyone's in by default. Sitting out? Say so before it starts.</p>
        <ul className="flex flex-wrap gap-2">
          {playing.map((m) => (
            <li key={m.user_id} className="rounded-full bg-honey-100 px-3 py-1 text-sm font-semibold text-honey-800">
              <Mention nickname={m.nickname ?? ''} />
            </li>
          ))}
          {playing.length === 0 && <li className="text-sm text-espresso-400">Nobody yet.</li>}
        </ul>
        {sittingOut.length > 0 && (
          <>
            <p className="pt-1 text-xs font-semibold text-espresso-400">Sitting out</p>
            <ul className="flex flex-wrap gap-2">
              {sittingOut.map((m) => (
                <li key={m.user_id} className="rounded-full bg-espresso-50 px-3 py-1 text-sm text-espresso-500">
                  <Mention nickname={m.nickname ?? ''} />
                </li>
              ))}
            </ul>
          </>
        )}

        {(() => {
          const mine = (members ?? []).find((m) => m.user_id === user?.id);
          if (!mine) return null;
          return (
            <RosterControl
              groupId={groupId}
              seasonId={season!.id}
              membershipStatus={mine.status as 'active' | 'dormant'}
              hasOptedOut={optedOutIds.has(mine.user_id)}
              hasOptedIn={optedInIds.has(mine.user_id)}
            />
          );
        })()}
      </Card>

      {isOwner && (
        <Card>
          <p className="mb-3 text-sm text-espresso-500">
            Continuing reseeds everyone playing and starts the season with betting paused, so you can open it once
            you're ready.
          </p>
          <ContinueButton groupId={groupId} playingCount={playing.length} />
        </Card>
      )}
    </main>
  );
}
