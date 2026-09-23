import { Card } from '@/components/ui/Card';
import { UserAvatar } from '@/components/ui/UserAvatar';
import { Mention } from '@/components/ui/Mention';
import { AwardGlyph } from '@/components/groups/AwardGlyph';
import { formatTokens, formatSignedTokens } from '@/lib/formatNumber';
import type { MemberProfileData } from '@/lib/memberProfile';

/**
 * The member profile's actual content, with no opinion on what wraps it — the full-page route
 * puts a `PageHeader` above it, the modal route puts `RouteModal`'s own banded header instead.
 * "Compare with someone" is not rendered here: the full-page route adds `CompareMemberPicker`
 * itself, and the modal route's `MemberProfileModal` owns the compare flow as its own step so it
 * can slide within the same panel — see that component's own comment.
 * See lib/memberProfile.ts for where `data` comes from.
 */
export function MemberProfileCard({ data }: { data: MemberProfileData }) {
  const { stats, groupName, standing, awards, isYou, net, sinceLabel, avatarUpdatedAt, avatarPresetKey, isPublicGroup, hidesPipelineStats } =
    data;

  return (
    <>
      <Card className="space-y-4">
        <div className="flex items-center gap-3.5">
          {!isPublicGroup && (
            <UserAvatar
              userId={stats.user_id}
              nickname={stats.nickname}
              avatarUpdatedAt={avatarUpdatedAt}
              avatarPresetKey={avatarPresetKey}
              className="h-14 w-14 text-lg"
              fallbackClassName="bg-rule text-signal"
              enlargeOnTap
            />
          )}
          <div className="min-w-0 flex-1">
            <Mention nickname={stats.nickname} className="block truncate font-display text-lg font-extrabold text-ink" />
            <p className="mt-0.5 truncate text-xs text-faint">{groupName}</p>
            <p className="mt-0.5 truncate text-xs text-faint">Here since {sinceLabel}</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 border-t border-hairline pt-4">
          <div>
            <p className="font-display text-2xl font-extrabold tabular-nums text-ink">{formatTokens(stats.balance)}</p>
            <p className="mt-0.5 text-[10.5px] font-bold tracking-[0.07em] text-faint uppercase">Tokens</p>
          </div>
          <div>
            <p className="font-display text-2xl font-extrabold tabular-nums text-ink">{standing}</p>
            <p className="mt-0.5 text-[10.5px] font-bold tracking-[0.07em] text-faint uppercase">Standing</p>
          </div>
          {hidesPipelineStats ? (
            <div className="col-span-2">
              <p className={`font-display text-2xl font-extrabold tabular-nums ${net >= 0 ? 'text-signal' : 'text-faint'}`}>
                {formatSignedTokens(net)}
              </p>
              <p className="mt-0.5 text-[10.5px] font-bold tracking-[0.07em] text-faint uppercase">All-time net</p>
            </div>
          ) : (
            <>
              <div>
                <p className="font-display text-2xl font-extrabold tabular-nums text-ink">
                  {stats.accuracy_pct == null ? '—' : `${stats.accuracy_pct}%`}
                </p>
                <p className="mt-0.5 text-[10.5px] font-bold tracking-[0.07em] text-faint uppercase">Accuracy</p>
              </div>
              <div>
                <p className={`font-display text-2xl font-extrabold tabular-nums ${net >= 0 ? 'text-signal' : 'text-faint'}`}>
                  {formatSignedTokens(net)}
                </p>
                <p className="mt-0.5 text-[10.5px] font-bold tracking-[0.07em] text-faint uppercase">All-time net</p>
              </div>
            </>
          )}
        </div>

        {!hidesPipelineStats && (
          <div className="grid grid-cols-2 gap-3 border-t border-hairline pt-4 text-sm">
            <div>
              <p className="font-semibold text-muted">Tokens wagered</p>
              <p className="text-muted">{formatTokens(Number(stats.tokens_wagered))} lifetime</p>
            </div>
            <div>
              <p className="font-semibold text-muted">Settled bets</p>
              <p className="text-muted">{stats.settled_bet_count}</p>
            </div>
          </div>
        )}

        {!hidesPipelineStats && (
          <div className="border-t border-hairline pt-4">
            <p className="text-[10.5px] font-bold tracking-[0.07em] text-faint uppercase">Best call</p>
            {stats.best_call_multiple ? (
              <p className="mt-1 text-sm font-bold text-ink">
                {stats.best_call_multiple.toFixed(1)}&times; on &ldquo;{stats.best_call_title}&rdquo;
              </p>
            ) : (
              <p className="mt-1 text-sm text-faint">Nothing settled yet.</p>
            )}
          </div>
        )}
      </Card>

      {awards.length > 0 && (
        <div className="space-y-[7px]">
          <p className="ml-1 text-[10.5px] font-extrabold tracking-[0.09em] text-faint uppercase">
            {isYou ? 'Your awards' : 'Awards held'}
          </p>
          {awards.map((award) => (
            <div key={`${award.kind}-${award.key}`} className="flex items-center gap-[11px] rounded-2xl border border-hairline bg-surface px-3.5 py-3">
              <span className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-full bg-signal-tint">
                <AwardGlyph iconKey={award.iconKey} stroke="var(--color-signal)" size={20} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[13.5px] font-extrabold text-ink">{award.label}</span>
                <span className="block text-[11px] leading-[1.4] text-faint">{award.description}</span>
              </span>
              <span className="shrink-0 text-[11px] font-extrabold text-signal">{award.stat}</span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
