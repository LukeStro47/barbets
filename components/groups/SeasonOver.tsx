import Link from 'next/link';
import type { ReactNode } from 'react';
import { UserAvatar } from '@/components/ui/UserAvatar';
import { RowChevron, StatCell } from '@/components/ui/Screen';
import { AwardGlyph } from '@/components/groups/AwardGlyph';
import { formatTokens, formatOrdinal, formatSignedTokens, numberWordCapitalized } from '@/lib/formatNumber';
import { cn } from '@/lib/cn';
import type { SeasonOverData } from '@/lib/seasonOver';

type Avatar = { avatar_updated_at: string | null; avatar_preset_key: string | null };

/**
 * 5n: a season, closed. The whole season end on one screen — what it was, the switcher to the
 * seasons before it, the champion and the stakes they won, where you finished, the awards as the
 * season closed (yours first, and any you lost), the final table, a way into its markets, and
 * (for the owner, on the season that just ended) the next season's setup. `setup` is that last
 * card; the footer that configures it is the caller's.
 */
export function SeasonOver({
  groupId,
  data,
  viewerId,
  avatars,
  setup,
}: {
  groupId: string;
  data: SeasonOverData;
  viewerId: string;
  avatars: Map<string, Avatar>;
  setup?: ReactNode;
}) {
  const { season, champion, you } = data;
  const weeks = season.endedAt ? Math.max(1, Math.round((new Date(season.endedAt).getTime() - new Date(season.startedAt).getTime()) / (7 * 86_400_000))) : null;
  const headline = `${weeks ? `${numberWordCapitalized(weeks)} week${weeks === 1 ? '' : 's'}, ` : ''}${data.marketsSettled} market${data.marketsSettled === 1 ? '' : 's'}, one winner.`;
  const stakesLine = [
    data.prizeText && champion ? `Prize: ${data.prizeText}` : null,
    data.punishmentText && data.loserNickname ? `${data.loserNickname}: ${data.punishmentText}` : null,
  ]
    .filter(Boolean)
    .join(' ');

  // The final table shows the top three, with the viewer's own row added if they finished lower.
  const top = data.finalBalances.slice(0, 3);
  const mineIndex = data.finalBalances.findIndex((r) => r.user_id === viewerId);
  const tableRows = mineIndex >= 3 ? [...top, data.finalBalances[mineIndex]] : top;
  const avatarFor = (uid: string) => avatars.get(uid);

  return (
    <div className="flex flex-col">
      <p className="text-[11px] font-bold tracking-[0.1em] text-signal uppercase">{season.name} · finished</p>
      <h1 className="mt-2.5 text-[30px] leading-[1.1] font-extrabold tracking-[-0.028em] text-ink text-pretty">{headline}</h1>

      <div className="mt-4 flex flex-wrap gap-[7px]">
        {data.seasons.map((s) => {
          const on = s.number === season.number;
          return (
            <Link
              key={s.number}
              href={`/groups/${groupId}/recap?season=${s.number}`}
              className={cn(
                'shrink-0 rounded-full px-3.5 py-2 text-[12px]',
                on ? 'bg-ink font-bold text-surface' : 'border border-hairline bg-surface font-semibold text-muted'
              )}
            >
              {s.label}
            </Link>
          );
        })}
        <Link
          href={`/groups/${groupId}/leaderboard?lens=alltime`}
          className="shrink-0 rounded-full border border-hairline bg-surface px-3.5 py-2 text-[12px] font-semibold text-muted"
        >
          All time
        </Link>
      </div>

      {champion && (
        <div className="mt-3.5 rounded-[24px] bg-ink p-[22px]">
          <div className="flex items-center gap-[13px]">
            <UserAvatar
              userId={champion.user_id}
              nickname={champion.nickname}
              avatarUpdatedAt={avatarFor(champion.user_id)?.avatar_updated_at}
              avatarPresetKey={avatarFor(champion.user_id)?.avatar_preset_key}
              className="h-[52px] w-[52px] text-[16px]"
              fallbackClassName="bg-white/10 text-on-ink"
            />
            <span className="min-w-0 flex-1">
              <span className="block text-[11px] font-bold tracking-[0.1em] text-faint uppercase">Champion</span>
              <span className="mt-1 block truncate text-[22px] font-extrabold tracking-[-0.02em] text-surface">{champion.nickname}</span>
            </span>
            <span className="shrink-0 text-right">
              <span className="block font-mono text-[26px] font-semibold tracking-[-0.02em] text-surface">{formatTokens(champion.balance)}</span>
              {champion.accuracy != null && <span className="mt-0.5 block text-[11px] text-faint">{champion.accuracy}% accuracy</span>}
            </span>
          </div>
          {stakesLine && (
            <p className="mt-4 border-t border-white/12 pt-3.5 text-[12.5px] leading-[1.45] text-[#a8b0bd] text-pretty">{stakesLine}</p>
          )}
        </div>
      )}

      {you && (
        <div className="mt-3 rounded-[22px] border border-hairline bg-surface px-5 py-[18px] shadow-[0_1px_2px_rgba(12,16,24,0.04)]">
          <p className="text-[11px] font-bold tracking-[0.1em] text-faint uppercase">You finished</p>
          <div className="mt-2 flex items-end justify-between gap-3.5">
            <span className="text-[32px] font-extrabold tracking-[-0.03em] text-ink">
              {formatOrdinal(you.rank)}
              <span className="text-[17px] font-bold text-faint"> of {you.of}</span>
            </span>
            {you.net !== 0 && (
              <span
                className={cn(
                  'inline-flex items-center rounded-lg px-[9px] py-[5px] font-mono text-[13px] font-semibold',
                  you.net > 0 ? 'bg-gain-bg text-gain' : 'bg-alert-bg text-alert'
                )}
              >
                {formatSignedTokens(you.net)}
              </span>
            )}
          </div>
          <div className="mt-4 flex border-t border-rule pt-3.5">
            <StatCell first label="Bets" value={you.bets} />
            <StatCell label="Accuracy" value={you.accuracy != null ? `${you.accuracy}%` : '—'} />
            <StatCell label="Best call" value={you.bestCall != null ? formatSignedTokens(you.bestCall) : '—'} tone={you.bestCall ? 'gain' : 'ink'} flex={1.2} />
          </div>
        </div>
      )}

      {(data.awards.length > 0 || data.lostTitles.length > 0) && (
        <>
          <p className="mt-5 text-[10.5px] font-bold tracking-[0.1em] text-faint uppercase">Awards, as the season closed</p>
          <div className="mt-[9px] flex flex-col gap-[9px]">
            {data.awards.map((a) => {
              const mine = a.holderUserId === viewerId;
              return (
                <div key={a.key} className="rounded-[20px] bg-ink p-4">
                  <div className="flex items-start justify-between gap-2.5">
                    <span className="text-[10px] font-extrabold tracking-[0.1em] text-on-ink uppercase">{mine ? 'Yours' : `@${a.holderNickname}`}</span>
                    <span className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full border-[1.5px] border-on-ink/45 bg-signal/18">
                      <AwardGlyph iconKey={a.iconKey} stroke="var(--color-on-ink)" size={17} />
                    </span>
                  </div>
                  <p className="mt-2.5 text-[17px] leading-[1.15] font-extrabold tracking-[-0.01em] text-surface">{a.label}</p>
                  {a.stat && <p className="mt-1 font-mono text-[12.5px] font-semibold text-on-ink">{a.stat}</p>}
                  <p className="mt-[11px] border-t border-white/12 pt-[11px] text-[12px] leading-[1.45] text-[#a8b0bd] text-pretty">{a.description}</p>
                </div>
              );
            })}
            {data.lostTitles.map((t) => (
              <div key={t.label} className="flex items-center gap-[11px] rounded-2xl border border-dashed border-dash bg-surface px-[15px] py-3.5">
                <span className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full border border-dashed border-dash">
                  <AwardGlyph iconKey={t.iconKey} stroke="var(--color-faint)" size={16} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[13.5px] font-bold text-muted">Lost this season: {t.label}</span>
                  <span className="mt-0.5 block text-[11.5px] leading-[1.4] text-faint">{t.toNickname} took it off you.</span>
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      <p className="mt-5 text-[10.5px] font-bold tracking-[0.1em] text-faint uppercase">Final table</p>
      <div className="mt-[9px] rounded-[18px] border border-hairline bg-surface px-[15px] py-0.5">
        {tableRows.map((r, i) => {
          const rank = data.finalBalances.indexOf(r) + 1;
          const mine = r.user_id === viewerId;
          const av = avatarFor(r.user_id);
          return (
            <div
              key={r.user_id}
              className={cn(
                'flex items-center gap-[11px] py-[11px]',
                i < tableRows.length - 1 && 'border-b border-rule',
                mine && '-mx-[15px] bg-signal-wash px-[15px]'
              )}
            >
              <span className={cn('w-3.5 font-mono text-[12px]', mine ? 'text-signal' : 'text-faint')}>{rank}</span>
              <UserAvatar
                userId={r.user_id}
                nickname={r.nickname}
                avatarUpdatedAt={av?.avatar_updated_at}
                avatarPresetKey={av?.avatar_preset_key}
                className="h-[26px] w-[26px] text-[10px]"
                fallbackClassName="bg-tile text-muted"
              />
              <span className={cn('min-w-0 flex-1 truncate text-[13.5px] font-bold', mine ? 'text-signal' : 'text-ink')}>{mine ? 'You' : r.nickname}</span>
              <span className={cn('font-mono text-[13px] font-semibold', mine ? 'text-signal' : 'text-ink')}>{formatTokens(r.balance)}</span>
            </div>
          );
        })}
      </div>
      <Link
        href={`/groups/${groupId}/seasons?season=${season.number}`}
        className="mt-[9px] flex items-center justify-between gap-2.5 rounded-2xl border border-hairline bg-surface px-[15px] py-[13px]"
      >
        <span className="text-[13px] font-bold text-ink">
          All {data.marketsSettled} market{data.marketsSettled === 1 ? '' : 's'} from this season
        </span>
        <RowChevron className="text-faint" />
      </Link>

      {setup && <div className="mt-3">{setup}</div>}
    </div>
  );
}
