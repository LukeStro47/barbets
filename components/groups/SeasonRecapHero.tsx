import { Mention } from '@/components/ui/Mention';
import { formatTokens, formatOrdinal, formatSignedTokens } from '@/lib/formatNumber';

export interface FinalBalanceRow {
  user_id: string;
  nickname: string;
  balance: number;
}

/**
 * The dark gradient recap card that replaces the balance card once a season is over. Two
 * variants sharing one shell: the owner always sees the champion (even when that's themself),
 * a member always sees their own result first — same split the settings page draws between
 * "owner only" and everyone else, just applied to what leads the hero rather than what's
 * gated behind a button.
 */
export function SeasonRecapHero({
  viewer,
  seasonName,
  marketsSettled,
  finalBalances,
  viewerUserId,
  viewerNet,
  viewerAccuracy,
  viewerTitlesHeld,
  loser,
  prizeText,
  punishmentText,
}: {
  viewer: 'owner' | 'member';
  seasonName: string;
  marketsSettled: number;
  finalBalances: FinalBalanceRow[];
  viewerUserId: string;
  /** Member view only. */
  viewerNet?: number;
  viewerAccuracy?: number | null;
  viewerTitlesHeld?: number;
  /** Whoever finished last, from season_results.snapshot.loser. */
  loser?: FinalBalanceRow | null;
  /** From season_results.snapshot, frozen at the moment this season closed. */
  prizeText?: string | null;
  punishmentText?: string | null;
}) {
  const champion = finalBalances[0];
  const runnerUp = finalBalances[1];
  const you = finalBalances.find((m) => m.user_id === viewerUserId);
  const yourRank = finalBalances.findIndex((m) => m.user_id === viewerUserId) + 1;
  const wonBy = champion && runnerUp ? champion.balance - runnerUp.balance : 0;
  const youLead = viewer === 'member' && yourRank === 1;

  return (
    <div className="relative overflow-hidden rounded-[28px] bg-gradient-to-br from-espresso-950 via-espresso-800 to-espresso-700 px-5 pt-[22px] pb-5">
      <div className="pointer-events-none absolute inset-0 opacity-[0.55] [background:radial-gradient(circle_at_88%_4%,rgba(232,163,61,0.34),rgba(232,163,61,0)_60%)]" />
      <div className="relative">
        <p className="text-[10.5px] font-bold tracking-[0.14em] text-honey-400 uppercase">Season complete</p>
        <p className="mt-1.5 font-display text-[27px] leading-[1.1] font-extrabold tracking-[-0.02em] text-paper-white">{seasonName}</p>
        <p className="mt-1.5 text-[12.5px] text-paper-white/50">
          {marketsSettled} market{marketsSettled === 1 ? '' : 's'}
        </p>

        {viewer === 'owner' ? (
          champion && (
            <div className="mt-5 flex items-center gap-3.5">
              <span className="flex h-[62px] w-[62px] shrink-0 -rotate-6 items-center justify-center rounded-full border-[3px] border-honey-500 bg-espresso-950 text-[26px] shadow-[0_8px_18px_-6px_rgba(232,163,61,0.55)]">
                🏆
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[10px] font-extrabold tracking-[0.1em] text-honey-300 uppercase">Champion</span>
                <Mention
                  nickname={champion.nickname}
                  className="mt-0.5 block truncate text-[21px] font-extrabold tracking-[-0.015em] text-paper-white"
                />
                <span className="mt-0.5 block text-[12.5px] text-paper-white/55">
                  {formatTokens(champion.balance)} tokens{wonBy > 0 && ` · won by ${formatTokens(wonBy)}`}
                </span>
              </span>
            </div>
          )
        ) : (
          <div className="mt-5 flex items-end gap-3.5">
            <span className="min-w-0 flex-1">
              <span className="block text-[10px] font-extrabold tracking-[0.1em] text-honey-300 uppercase">You finished</span>
              <span className="mt-1 block font-display text-[44px] leading-none font-extrabold tracking-[-0.03em] text-paper-white">
                {formatOrdinal(yourRank)}
              </span>
              <span className="mt-1 block text-[12.5px] text-paper-white/55">
                {youLead ? (
                  `of ${finalBalances.length}`
                ) : (
                  <>
                    of {finalBalances.length} · behind {champion && <Mention nickname={champion.nickname} />}
                  </>
                )}
              </span>
            </span>
            <span className="shrink-0 text-right">
              <span className="block text-xl font-extrabold text-honey-300">{formatTokens(you?.balance ?? 0)}</span>
              <span className="mt-0.5 block text-[10.5px] font-extrabold tracking-[0.07em] text-paper-white/45 uppercase">Final tokens</span>
            </span>
          </div>
        )}

        <div className="relative -mx-5 mt-[18px] border-t-2 border-dashed border-white/15">
          <span className="absolute top-1/2 -left-2.5 h-5 w-5 -translate-y-1/2 rounded-full bg-paper" />
          <span className="absolute top-1/2 -right-2.5 h-5 w-5 -translate-y-1/2 rounded-full bg-paper" />
        </div>

        {/* Same copy for both views, kept terse and universal like the rest of this hero — a
            member reads exactly what the owner reads. */}
        {(prizeText || punishmentText) && (
          <div className="mt-[18px] flex flex-col gap-1.5 rounded-2xl bg-white/[0.06] px-3.5 py-3">
            {prizeText && champion && (
              <p className="text-[12.5px] leading-[1.45] text-paper-white/80">
                🏆 <span className="font-bold text-paper-white">{champion.nickname}</span> gets: {prizeText}
              </p>
            )}
            {punishmentText && loser && (
              <p className="text-[12.5px] leading-[1.45] text-paper-white/80">
                💀 <span className="font-bold text-paper-white">{loser.nickname}</span> owes: {punishmentText}
              </p>
            )}
          </div>
        )}

        {viewer === 'owner' ? (
          <div className="mt-[18px] flex gap-3">
            {[runnerUp, finalBalances[2]].filter((m): m is FinalBalanceRow => !!m).map((m, i) => (
              <span key={m.user_id} className="flex-1 rounded-2xl bg-white/[0.06] px-3 py-2.5">
                <span className="block text-[10px] font-extrabold tracking-[0.08em] text-paper-white/40 uppercase">
                  {i === 0 ? '2nd' : '3rd'}
                  {m.user_id === viewerUserId ? ' · you' : ''}
                </span>
                <Mention nickname={m.nickname} className="mt-[3px] block text-sm font-extrabold text-paper-white" />
                <span className="block text-xs text-honey-200">{formatTokens(m.balance)}</span>
              </span>
            ))}
          </div>
        ) : (
          <div className="mt-[18px] flex gap-3">
            <span className="flex-1">
              <span className="block text-base font-extrabold text-paper-white">{formatSignedTokens(viewerNet ?? 0)}</span>
              <span className="block text-[10px] font-extrabold tracking-[0.07em] text-paper-white/45 uppercase">net for the season</span>
            </span>
            <span className="flex-1">
              <span className="block text-base font-extrabold text-paper-white">{viewerAccuracy == null ? '—' : `${viewerAccuracy}%`}</span>
              <span className="block text-[10px] font-extrabold tracking-[0.07em] text-paper-white/45 uppercase">accuracy</span>
            </span>
            <span className="flex-1">
              <span className="block text-base font-extrabold text-paper-white">{viewerTitlesHeld ?? 0}</span>
              <span className="block text-[10px] font-extrabold tracking-[0.07em] text-paper-white/45 uppercase">
                title{(viewerTitlesHeld ?? 0) === 1 ? '' : 's'} held
              </span>
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
