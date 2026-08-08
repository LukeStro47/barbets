import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/ui/PageHeader';
import { EmptyState } from '@/components/ui/EmptyState';
import { Mention } from '@/components/ui/Mention';
import { AwardGlyph } from '@/components/groups/AwardGlyph';
import { TITLE_ORDER, TITLE_META, type GroupTitleRow } from '@/lib/titles';

export default async function AwardsPage({ params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

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
  // Every title the viewer currently holds gets its own hero card at the top — not just the
  // first one — so holding several titles actually reads as holding several titles.
  const yourKeys = heldKeys.filter((k) => rowsByKey.get(k)?.user_id === user?.id);

  return (
    <main className="mx-auto max-w-lg space-y-6 px-5 py-8">
      <PageHeader
        title="Awards"
        subtitle="Who currently holds what, updated as the group plays."
        backHref={`/groups/${groupId}/leaderboard`}
        backLabel="Leaderboard"
        action={
          activeSeason && (
            <span className="shrink-0 rounded-full bg-espresso-100 px-3 py-1 text-xs font-bold text-espresso-700">
              {activeSeason.name ?? `Season ${activeSeason.number}`}
            </span>
          )
        }
      />

      {yourKeys.length > 0 && (
        <div className="space-y-2.5">
          {yourKeys.map((key) => (
            <div
              key={key}
              className="relative overflow-hidden rounded-[22px] bg-gradient-to-br from-espresso-900 via-espresso-800 to-espresso-700 p-[18px] text-paper-white"
            >
              <div className="pointer-events-none absolute inset-0 opacity-55 [background:radial-gradient(circle_at_86%_6%,rgba(232,163,61,0.32),rgba(232,163,61,0)_62%)]" />
              <div className="relative flex items-center gap-3.5">
                <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full border-[1.5px] border-honey-300/45 bg-honey-500/16">
                  <AwardGlyph titleKey={key} stroke="var(--color-honey-300)" size={27} />
                </span>
                <span className="min-w-0 flex-1">
                  <p className="text-[10.5px] font-extrabold tracking-[0.1em] text-honey-400 uppercase">Yours</p>
                  <p className="mt-0.5 text-lg font-extrabold tracking-[-0.015em]">{TITLE_META[key].label}</p>
                  <p className="mt-0.5 text-[12.5px] leading-[1.45] text-paper-white/60">
                    {TITLE_META[key].format(rowsByKey.get(key)!.stat_value)}
                  </p>
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      <div>
        <h3 className="mb-2.5 ml-1 text-[11px] font-extrabold tracking-[0.08em] text-espresso-400 uppercase">Held right now</h3>
        {heldKeys.length === 0 ? (
          <EmptyState icon="🏆" title="Nobody's earned a title yet" subtitle="Keep playing, they'll start filling in." />
        ) : (
          <div className="space-y-2">
            {heldKeys.map((key) => {
              const meta = TITLE_META[key];
              const row = rowsByKey.get(key)!;
              const isYou = row.user_id === user?.id;
              const nickname = nicknameByUserId.get(row.user_id!) ?? '';
              return (
                <div
                  key={key}
                  className={`rounded-[18px] px-3.5 py-3 ${
                    isYou ? 'border-[1.5px] border-honey-500 bg-honey-500/10' : 'border border-espresso-100 bg-paper-white'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <span
                      className={`flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-full ${
                        isYou ? 'bg-honey-500' : 'bg-honey-50'
                      }`}
                    >
                      <AwardGlyph titleKey={key} stroke={isYou ? 'var(--color-espresso-900)' : 'var(--color-honey-700)'} />
                    </span>
                    <span className="min-w-0 flex-1 text-[14px] font-extrabold tracking-[-0.005em] text-espresso-900">{meta.label}</span>
                    <span className="shrink-0 text-right">
                      <Mention nickname={nickname} className="block text-[12.5px] font-bold text-espresso-900" />
                      <span className="mt-0.5 block text-[11px] font-extrabold text-honey-700">{meta.format(row.stat_value)}</span>
                    </span>
                  </div>
                  {/* Description gets its own full-width line below, instead of squeezing next to
                      the holder's name/stat on the right — the two used to fight for space and cut
                      the description off awkwardly. */}
                  <p className="mt-1.5 pl-[54px] text-[11.5px] leading-[1.4] text-espresso-400">{meta.description}</p>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {vacantKeys.length > 0 && (
        <div>
          <h3 className="mb-2.5 ml-1 text-[11px] font-extrabold tracking-[0.08em] text-espresso-400 uppercase">Up for grabs</h3>
          <div className="space-y-2">
            {vacantKeys.map((key) => {
              const meta = TITLE_META[key];
              return (
                <div key={key} className="rounded-[18px] border-[1.5px] border-dashed border-espresso-200 px-3.5 py-3">
                  <div className="flex items-center gap-3">
                    <span className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-full border-[1.5px] border-dashed border-espresso-200">
                      <AwardGlyph titleKey={key} stroke="var(--color-espresso-300)" />
                    </span>
                    <span className="min-w-0 flex-1 text-[14px] font-extrabold text-espresso-600">{meta.label}</span>
                    <span className="shrink-0 text-[11px] font-bold text-espresso-300">Unclaimed</span>
                  </div>
                  <p className="mt-1.5 pl-[54px] text-[11.5px] leading-[1.4] text-espresso-400">{meta.description}</p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* The group can't yet propose its own custom awards (see README) — this stays a visible,
          disabled placeholder rather than hidden, so people know it's coming rather than assuming
          the eight above are the whole feature forever. */}
      <div className="flex items-center gap-3 rounded-2xl bg-espresso-50 px-4 py-3.5 opacity-70">
        <span className="min-w-0 flex-1">
          <p className="text-[13.5px] font-extrabold text-espresso-700">Propose an award</p>
          <p className="mt-0.5 text-xs leading-[1.45] text-espresso-400">Coming soon: name your own, group votes it in.</p>
        </span>
        <span className="shrink-0 rounded-full bg-espresso-100 px-2.5 py-1 text-[10.5px] font-bold text-espresso-400">Soon</span>
      </div>
    </main>
  );
}
