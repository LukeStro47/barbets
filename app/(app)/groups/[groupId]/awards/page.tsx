import { createClient, requireUser } from '@/lib/supabase/server';
import { PageHeader } from '@/components/ui/PageHeader';
import { EmptyState } from '@/components/ui/EmptyState';
import { Mention } from '@/components/ui/Mention';
import { AwardGlyph } from '@/components/groups/AwardGlyph';
import { AwardsRail, UnclaimedTitles } from '@/components/groups/AwardsSections';
import { TITLE_ORDER, TITLE_META, type GroupTitleRow } from '@/lib/titles';
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

  const [{ data: settings }, { data: titleRows }, { data: members }] = await Promise.all([
    supabase.from('group_settings').select('seasons_enabled').eq('group_id', groupId).single(),
    supabase.from('group_titles').select('title_key, user_id, stat_value').eq('group_id', groupId),
    supabase.from('memberships').select('user_id, nickname').eq('group_id', groupId).neq('status', 'removed'),
  ]);

  const { data: activeSeason } = settings?.seasons_enabled
    ? await supabase.from('seasons').select('number, name').eq('group_id', groupId).eq('status', 'active').maybeSingle()
    : { data: null };

  const nicknameByUserId = new Map((members ?? []).map((m) => [m.user_id, m.nickname]));
  const rowsByKey = new Map(((titleRows ?? []) as GroupTitleRow[]).map((r) => [r.title_key, r]));

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
          activeSeason && (
            <span className="shrink-0 rounded-full bg-espresso-50 px-3 py-1 text-[11.5px] font-extrabold text-espresso-700">
              {activeSeason.name ?? `Season ${activeSeason.number}`}
            </span>
          )
        }
        subtitle={
          <span className="text-[13px] text-espresso-500">
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
        <AwardsRail titles={yourKeys.map((key) => ({ key, stat: TITLE_META[key].format(rowsByKey.get(key)!.stat_value) }))} />
      )}

      {heldKeys.length === 0 ? (
        <EmptyState icon="🏆" title="Nobody's earned a title yet" subtitle="Keep playing, they'll start filling in." />
      ) : (
        otherKeys.length > 0 && (
          <div className="space-y-[7px]">
            <p className="ml-1 text-[10.5px] font-extrabold tracking-[0.09em] text-espresso-400 uppercase">Held by others</p>
            {otherKeys.map((key) => {
              const meta = TITLE_META[key];
              const row = rowsByKey.get(key)!;
              return (
                <div key={key} className="flex items-center gap-[11px] rounded-2xl border border-espresso-100 bg-paper-white px-3.5 py-3">
                  <span className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-full bg-honey-50">
                    <AwardGlyph titleKey={key} stroke="var(--color-honey-700)" size={20} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13.5px] font-extrabold text-espresso-950">{meta.label}</span>
                    <span className="block text-[11px] leading-[1.4] text-espresso-400">{meta.description}</span>
                  </span>
                  <span className="shrink-0 text-right">
                    <Mention
                      nickname={nicknameByUserId.get(row.user_id!) ?? ''}
                      className="block text-[12.5px] font-extrabold text-espresso-950"
                    />
                    <span className="block text-[11px] font-extrabold text-honey-700">{meta.format(row.stat_value)}</span>
                  </span>
                </div>
              );
            })}
          </div>
        )
      )}

      {vacantKeys.length > 0 && <UnclaimedTitles keys={vacantKeys} />}
    </main>
  );
}
