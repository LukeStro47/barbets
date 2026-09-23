import { Mention } from '@/components/ui/Mention';
import { formatTokens, formatOrdinal, formatSignedTokens } from '@/lib/formatNumber';

export interface FinalBalanceRow {
  user_id: string;
  nickname: string;
  balance: number;
}

/**
 * The ink recap card that replaces the balance card once a season is over. Two
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
    <div className="relative overflow-hidden rounded-[26px] bg-ink px-5 pt-[22px] pb-5">
      <div className="relative">
        <p className="text-[11.5px] font-bold tracking-[0.1em] text-on-ink uppercase">Season complete</p>
        <p className="mt-1.5 text-[27px] leading-[1.14] font-extrabold tracking-[-0.025em] text-white">{seasonName}</p>
        <p className="mt-1.5 font-mono text-[12.5px] font-semibold text-white/50">
          {marketsSettled} market{marketsSettled === 1 ? '' : 's'}
        </p>

        {viewer === 'owner' ? (
          champion && (
            <div className="mt-5 flex items-center gap-3.5">
              <span className="flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-[11px] border border-white/15 bg-white/[0.06] font-mono text-[18px] font-semibold text-on-ink">
                1
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[11.5px] font-bold tracking-[0.1em] text-on-ink uppercase">Champion</span>
                <Mention
                  nickname={champion.nickname}
                  className="mt-0.5 block truncate text-[21px] font-extrabold tracking-[-0.015em] text-white"
                />
                <span className="mt-0.5 block font-mono text-[12.5px] font-semibold text-white/55">
                  {formatTokens(champion.balance)}
                  {wonBy > 0 && ` · won by ${formatTokens(wonBy)}`}
                </span>
              </span>
            </div>
          )
        ) : (
          <div className="mt-5 flex items-end gap-3.5">
            <span className="min-w-0 flex-1">
              <span className="block text-[11.5px] font-bold tracking-[0.1em] text-on-ink uppercase">You finished</span>
              <span className="mt-1 block font-mono text-[42px] leading-none font-semibold tracking-[-0.03em] text-white">
                {formatOrdinal(yourRank)}
              </span>
              <span className="mt-1 block text-[12.5px] text-white/55">
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
              <span className="block font-mono text-[15px] font-semibold text-on-ink">{formatTokens(you?.balance ?? 0)}</span>
              <span className="mt-0.5 block text-[11.5px] font-bold tracking-[0.1em] text-white/45 uppercase">Final</span>
            </span>
          </div>
        )}

        <div className="relative -mx-5 mt-[18px] border-t border-dashed border-white/15">
          <span className="absolute top-1/2 -left-2.5 h-5 w-5 -translate-y-1/2 rounded-full bg-canvas" />
          <span className="absolute top-1/2 -right-2.5 h-5 w-5 -translate-y-1/2 rounded-full bg-canvas" />
        </div>

        {/* Same copy for both views, kept terse and universal like the rest of this hero — a
            member reads exactly what the owner reads. */}
        {(prizeText || punishmentText) && (
          <div className="mt-[18px] flex flex-col gap-1.5 rounded-[14px] border border-white/10 px-3.5 py-3">
            {prizeText && champion && (
              <p className="text-[12.5px] leading-[1.45] text-white/80">
                <span className="font-bold text-white">{champion.nickname}</span> gets: {prizeText}
              </p>
            )}
            {punishmentText && loser && (
              <p className="text-[12.5px] leading-[1.45] text-white/80">
                <span className="font-bold text-white">{loser.nickname}</span> owes: {punishmentText}
              </p>
            )}
          </div>
        )}

        {viewer === 'owner' ? (
          <div className="mt-[18px] flex gap-3">
            {[runnerUp, finalBalances[2]].filter((m): m is FinalBalanceRow => !!m).map((m, i) => (
              <span key={m.user_id} className="flex-1 rounded-[14px] border border-white/10 px-3 py-2.5">
                <span className="block text-[11.5px] font-bold tracking-[0.1em] text-white/40 uppercase">
                  {i === 0 ? '2nd' : '3rd'}
                  {m.user_id === viewerUserId ? ' · you' : ''}
                </span>
                <Mention nickname={m.nickname} className="mt-[3px] block text-sm font-bold text-white" />
                <span className="block font-mono text-[12.5px] font-semibold text-on-ink">{formatTokens(m.balance)}</span>
              </span>
            ))}
          </div>
        ) : (
          <div className="mt-[18px] flex gap-3">
            <span className="flex-1">
              <span className="block font-mono text-[15px] font-semibold text-white">{formatSignedTokens(viewerNet ?? 0)}</span>
              <span className="block text-[11.5px] font-bold tracking-[0.1em] text-white/45 uppercase">net</span>
            </span>
            <span className="flex-1">
              <span className="block font-mono text-[15px] font-semibold text-white">{viewerAccuracy == null ? '—' : `${viewerAccuracy}%`}</span>
              <span className="block text-[11.5px] font-bold tracking-[0.1em] text-white/45 uppercase">accuracy</span>
            </span>
            <span className="flex-1">
              <span className="block font-mono text-[15px] font-semibold text-white">{viewerTitlesHeld ?? 0}</span>
              <span className="block text-[11.5px] font-bold tracking-[0.1em] text-white/45 uppercase">
                title{(viewerTitlesHeld ?? 0) === 1 ? '' : 's'}
              </span>
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
