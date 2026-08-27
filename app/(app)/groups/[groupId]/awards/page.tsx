import Link from 'next/link';
import { createClient, requireUser } from '@/lib/supabase/server';
import { PageHeader } from '@/components/ui/PageHeader';
import { EmptyState } from '@/components/ui/EmptyState';
import { Mention } from '@/components/ui/Mention';
import { AwardGlyph } from '@/components/groups/AwardGlyph';
import { ChevronRightIcon } from '@/components/ui/icons';
import { EditTitleButton } from '@/components/groups/EditTitleButton';
import { AwardsRail, UnclaimedTitles } from '@/components/groups/AwardsSections';
import { LostTitleCard } from '@/components/groups/LostTitleCard';
import { CustomAwardsSection } from '@/components/groups/CustomAwardsSection';
import { TITLE_ORDER, TITLE_META, type GroupTitleRow } from '@/lib/titles';
import { diffTitleSnapshots, type TitleSnapshotEntry } from '@/lib/seasonTitleDiff';
import type { CustomGroupTitle, CustomGroupTitleHolder } from '@/lib/customAwards';
import { numberWord, numberWordCapitalized } from '@/lib/formatNumber';

/** "@marta and @ros", "@marta, @ros and @jake", "@marta, @ros and two others" — the holders named
 * rather than counted, up to the point where a list stops being readable. */
function holderList(nicknames: string[]): string {
  if (nicknames.length <= 3) {
    const named = nicknames.map((n) => `@${n}`);
    return named.length === 1 ? named[0] : `${named.slice(0, -1).join(', ')} and ${named[named.length - 1]}`;
  }
  const shown = nicknames.slice(0, 2).map((n) => `@${n}`);
  const rest = nicknames.length - 2;
  return `${shown.join(', ')} and ${numberWord(rest)} others`;
}

export default async function AwardsPage({ params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await params;
  const supabase = await createClient();
  const user = await requireUser(supabase);

  const [{ data: settings }, { data: titleRows }, { data: members }, { data: group }, { data: customTitles }] = await Promise.all([
    supabase.from('group_settings').select('seasons_enabled, awards_enabled').eq('group_id', groupId).single(),
    supabase.from('group_titles').select('title_key, user_id, stat_value, label, icon_key').eq('group_id', groupId),
    supabase.from('memberships').select('id, user_id, nickname').eq('group_id', groupId).neq('status', 'removed'),
    supabase.from('groups').select('owner_id').eq('id', groupId).single(),
    supabase.from('custom_group_titles').select('id, group_id, label, icon_key, metric, direction').eq('group_id', groupId),
  ]);

  if (settings && !settings.awards_enabled) {
    return (
      <main className="mx-auto max-w-lg space-y-4 px-5 py-8">
        <PageHeader title="Awards" backHref={`/groups/${groupId}/leaderboard`} backLabel="Leaderboard" />
        <EmptyState icon="🚫" title="Not available in this group" subtitle="This group doesn't run titles or custom awards." />
      </main>
    );
  }

  const customTitleIds = (customTitles ?? []).map((t) => t.id);
  const { data: customHolders } =
    customTitleIds.length > 0
      ? await supabase.from('custom_group_title_holders').select('custom_title_id, user_id, stat_value').in('custom_title_id', customTitleIds)
      : { data: [] };
  const holderByTitleId = new Map(((customHolders ?? []) as CustomGroupTitleHolder[]).map((h) => [h.custom_title_id, h]));
  const isOwner = group?.owner_id === user?.id;

  // Any status, not just active — this is how the page knows to switch into "frozen at close"
  // framing. `latestSeason` is the *next* season's intermission row once the season has ended
  // (see _finalize_season), so the season being recapped is number - 1.
  const { data: latestSeason } = settings?.seasons_enabled
    ? await supabase.from('seasons').select('number, name, status').eq('group_id', groupId).order('number', { ascending: false }).limit(1).maybeSingle()
    : { data: null };
  const isIntermission = latestSeason?.status === 'intermission';
  const activeSeason = latestSeason?.status === 'active' ? latestSeason : null;

  const { data: endedSeason } = isIntermission
    ? await supabase.from('seasons').select('number, name').eq('group_id', groupId).eq('number', latestSeason!.number - 1).maybeSingle()
    : { data: null };

  const nicknameByUserId = new Map((members ?? []).map((m) => [m.user_id, m.nickname]));
  const membershipIdByUserId = new Map((members ?? []).map((m) => [m.user_id, m.id]));
  const rowsByKey = new Map(((titleRows ?? []) as GroupTitleRow[]).map((r) => [r.title_key, r]));

  // Resolves a title's owner overrides against TITLE_META's defaults — every place a fixed title
  // renders (AwardsRail, held-by-others, UnclaimedTitles, LostTitleCard) uses this instead of
  // reading TITLE_META directly, so a renamed/re-iconed title shows consistently everywhere.
  function resolveTitle(key: (typeof TITLE_ORDER)[number]) {
    const meta = TITLE_META[key];
    const row = rowsByKey.get(key);
    return { key, label: row?.label ?? meta.label, description: meta.description, iconKey: row?.icon_key ?? meta.defaultIconKey };
  }

  // Titles are lifetime/live (see lib/titles.ts), never reset at a season boundary, and nothing
  // re-resolves during intermission — so the live rows above are already exactly "as they stood
  // when the season closed." What they can't show on their own is what changed: for that, diff
  // against the titles_snapshot the *previous* season's finalize captured (see
  // supabase/migrations/20260823140000_season_end_stats_and_title_snapshot.sql), which is "who
  // held what at the start of the season that just ended."
  let lostTitles: { key: (typeof TITLE_ORDER)[number]; label: string; iconKey: string; toNickname: string }[] = [];
  if (isIntermission && endedSeason && endedSeason.number > 1) {
    const { data: priorResult } = await supabase
      .from('season_results')
      .select('snapshot, seasons!inner(number)')
      .eq('group_id', groupId)
      .eq('seasons.number', endedSeason.number - 1)
      .maybeSingle();
    const priorTitlesSnapshot = (priorResult?.snapshot as { titles_snapshot?: TitleSnapshotEntry[] } | undefined)?.titles_snapshot ?? null;
    const currentSnapshot: TitleSnapshotEntry[] = ((titleRows ?? []) as GroupTitleRow[]).map((r) => ({
      title_key: r.title_key,
      user_id: r.user_id,
      nickname: r.user_id ? (nicknameByUserId.get(r.user_id) ?? null) : null,
      stat_value: r.stat_value,
    }));
    lostTitles = diffTitleSnapshots(currentSnapshot, priorTitlesSnapshot)
      .filter((c) => c.fromUserId === user?.id)
      .map((c) => {
        const resolved = resolveTitle(c.titleKey);
        return { key: c.titleKey, label: resolved.label, iconKey: resolved.iconKey, toNickname: c.toNickname };
      });
  }

  const heldKeys = TITLE_ORDER.filter((k) => rowsByKey.get(k)?.user_id);
  const vacantKeys = TITLE_ORDER.filter((k) => !rowsByKey.get(k)?.user_id);
  const yourKeys = heldKeys.filter((k) => rowsByKey.get(k)?.user_id === user?.id);
  const otherKeys = heldKeys.filter((k) => rowsByKey.get(k)?.user_id !== user?.id);

  // The count first, then who has the rest — the two facts anyone opening this page came for,
  // before the cards that justify them.
  const otherHolders = [...new Set(otherKeys.map((k) => nicknameByUserId.get(rowsByKey.get(k)!.user_id!) ?? ''))].filter(Boolean);
  const othersSentence =
    otherKeys.length > 0
      ? `${numberWordCapitalized(otherKeys.length)} ${otherKeys.length === 1 ? 'sits' : 'sit'} with ${holderList(otherHolders)}.`
      : null;

  return (
    <main className="mx-auto max-w-lg space-y-4 px-5 py-8">
      <PageHeader
        title="Awards"
        backHref={`/groups/${groupId}/leaderboard`}
        backLabel="Leaderboard"
        backAction={
          (activeSeason || (isIntermission && endedSeason)) && (
            <span className="shrink-0 rounded-full bg-espresso-50 px-3 py-1 text-[11.5px] font-extrabold text-espresso-700">
              {isIntermission ? `${endedSeason?.name ?? `Season ${endedSeason?.number ?? ''}`} · final` : (activeSeason?.name ?? `Season ${activeSeason?.number}`)}
            </span>
          )
        }
        subtitle={
          <span className="text-[13px] text-espresso-500">
            {isIntermission && 'Titles as they stood when the season closed. '}
            {yourKeys.length > 0 ? (
              <>
                You hold{' '}
                <span className="font-extrabold text-honey-700">
                  {numberWord(yourKeys.length)} of {numberWord(TITLE_ORDER.length)}
                </span>{' '}
                titles.
              </>
            ) : (
              <>None of the {numberWord(TITLE_ORDER.length)} titles are yours yet.</>
            )}
            {othersSentence && ` ${othersSentence}`}
          </span>
        }
      />

      {yourKeys.length > 0 && (
        <AwardsRail
          groupId={groupId}
          isOwner={isOwner}
          titles={yourKeys.map((key) => ({ ...resolveTitle(key), stat: TITLE_META[key].format(rowsByKey.get(key)!.stat_value) }))}
        />
      )}

      {lostTitles.length > 0 && (
        <div className="grid grid-cols-2 gap-2.5">
          {lostTitles.map((t) => (
            <LostTitleCard key={t.key} label={t.label} iconKey={t.iconKey} toNickname={t.toNickname} />
          ))}
        </div>
      )}

      {heldKeys.length === 0 ? (
        <EmptyState icon="🏆" title="Nobody's earned a title yet" subtitle="Keep playing, they'll start filling in." />
      ) : (
        otherKeys.length > 0 && (
          <div className="space-y-[7px]">
            <p className="ml-1 text-[10.5px] font-extrabold tracking-[0.09em] text-espresso-400 uppercase">Held by others</p>
            {otherKeys.map((key) => {
              const resolved = resolveTitle(key);
              const row = rowsByKey.get(key)!;
              const holderMembershipId = membershipIdByUserId.get(row.user_id!);
              const content = (
                <>
                  <span className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-full bg-honey-50">
                    <AwardGlyph iconKey={resolved.iconKey} stroke="var(--color-honey-700)" size={20} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13.5px] font-extrabold text-espresso-950">{resolved.label}</span>
                    <span className="block text-[11px] leading-[1.4] text-espresso-400">{resolved.description}</span>
                  </span>
                  <span className="shrink-0 text-right">
                    <Mention
                      nickname={nicknameByUserId.get(row.user_id!) ?? ''}
                      className="block text-[12.5px] font-extrabold text-espresso-950"
                    />
                    <span className="block text-[11px] font-extrabold text-honey-700">{TITLE_META[key].format(row.stat_value)}</span>
                  </span>
                  {holderMembershipId && <ChevronRightIcon className="h-3 w-[7px] shrink-0 text-espresso-300" />}
                </>
              );
              const rowClassName = 'flex flex-1 items-center gap-[11px] rounded-2xl border border-espresso-100 bg-paper-white px-3.5 py-3';
              // A holder is always a current, non-removed member as of the last title recompute —
              // the fallback to a plain (unlinked) row only matters for the rare window where
              // someone's left/been removed since, since titles only recompute every 3rd resolution.
              return (
                <div key={key} className="flex items-center gap-2">
                  {holderMembershipId ? (
                    <Link href={`/groups/${groupId}/members/${holderMembershipId}`} className={rowClassName}>
                      {content}
                    </Link>
                  ) : (
                    <div className={rowClassName}>{content}</div>
                  )}
                  {isOwner && (
                    <EditTitleButton
                      groupId={groupId}
                      titleKey={key}
                      currentLabel={resolved.label}
                      currentIconKey={resolved.iconKey}
                      defaultLabel={TITLE_META[key].label}
                    />
                  )}
                </div>
              );
            })}
          </div>
        )
      )}

      {vacantKeys.length > 0 && <UnclaimedTitles groupId={groupId} isOwner={isOwner} titles={vacantKeys.map((key) => resolveTitle(key))} />}

      <CustomAwardsSection
        groupId={groupId}
        isOwner={isOwner}
        titles={(customTitles ?? []) as CustomGroupTitle[]}
        holderByTitleId={holderByTitleId}
        nicknameByUserId={nicknameByUserId}
        membershipIdByUserId={membershipIdByUserId}
        currentUserId={user?.id}
      />
    </main>
  );
}
