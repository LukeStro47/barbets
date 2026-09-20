import { UserAvatar } from '@/components/ui/UserAvatar';
import { Mention } from '@/components/ui/Mention';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { formatTokens, formatSignedTokens } from '@/lib/formatNumber';
import type { HeadToHeadData, HeadToHeadMemberStats } from '@/lib/headToHead';

/** A compact two-column stat card, reused for both sides of the comparison. */
function StatColumn({ stats, isPublicGroup }: { stats: HeadToHeadMemberStats; isPublicGroup: boolean }) {
  const net = Number(stats.net);
  return (
    <div className="flex-1 space-y-3">
      <div className="flex items-center gap-2">
        {!isPublicGroup && (
          <UserAvatar
            userId={stats.user_id}
            nickname={stats.nickname}
            avatarUpdatedAt={stats.avatarUpdatedAt}
            avatarPresetKey={stats.avatarPresetKey}
            className="h-9 w-9 text-xs"
            fallbackClassName="bg-rule text-signal"
          />
        )}
        <Mention nickname={stats.nickname} className="min-w-0 truncate font-display text-sm font-extrabold text-ink" />
      </div>
      <div className="space-y-2 text-sm">
        <div className="flex items-baseline justify-between">
          <span className="text-faint">Tokens</span>
          <span className="font-bold tabular-nums text-ink">{formatTokens(stats.balance)}</span>
        </div>
        <div className="flex items-baseline justify-between">
          <span className="text-faint">Accuracy</span>
          <span className="font-bold tabular-nums text-ink">{stats.accuracy_pct == null ? '—' : `${stats.accuracy_pct}%`}</span>
        </div>
        <div className="flex items-baseline justify-between">
          <span className="text-faint">Net</span>
          <span className={`font-bold tabular-nums ${net >= 0 ? 'text-signal' : 'text-faint'}`}>{formatSignedTokens(net)}</span>
        </div>
        <div className="flex items-baseline justify-between">
          <span className="text-faint">Wagered</span>
          <span className="font-bold tabular-nums text-ink">{formatTokens(Number(stats.tokens_wagered))}</span>
        </div>
      </div>
    </div>
  );
}

/**
 * The actual head-to-head content: both stat columns plus every shared market, with no opinion on
 * what wraps it — the full-page route puts a `PageHeader` above it, `CompareMemberPicker`'s inline
 * modal step puts its own banded header instead. Mirrors `MemberProfileCard`'s split between data
 * shape (lib/headToHead.ts) and presentation.
 */
export function HeadToHeadCard({ data }: { data: HeadToHeadData }) {
  const { a, b, markets, isPublicGroup } = data;

  return (
    <div className="space-y-5">
      <Card>
        <div className="flex gap-4">
          <StatColumn stats={a} isPublicGroup={isPublicGroup} />
          <div className="w-px shrink-0 bg-rule" />
          <StatColumn stats={b} isPublicGroup={isPublicGroup} />
        </div>
      </Card>

      <div>
        <p className="mb-2 ml-1 text-[10.5px] font-extrabold tracking-[0.09em] text-faint uppercase">Markets you&apos;ve both bet on</p>
        {markets.length === 0 ? (
          <EmptyState icon="🤝" title="No shared markets yet" subtitle="Once you've both bet on the same market, it shows up here." />
        ) : (
          <div className="space-y-2">
            {markets.map((m) => {
              const aWon = m.a_payout > m.a_amount;
              const bWon = m.b_payout > m.b_amount;
              return (
                <Card key={m.market_id} className="space-y-2.5">
                  <p className="truncate text-sm font-bold text-ink">{m.title}</p>
                  <div className="flex gap-4 text-[13px]">
                    <div className="flex-1 space-y-0.5">
                      <p className="truncate text-muted">{m.a_choice}</p>
                      <p className={`font-bold tabular-nums ${aWon ? 'text-signal' : 'text-faint'}`}>
                        {formatSignedTokens(Number(m.a_payout) - Number(m.a_amount))}
                      </p>
                    </div>
                    <div className="w-px shrink-0 bg-rule" />
                    <div className="flex-1 space-y-0.5">
                      <p className="truncate text-muted">{m.b_choice}</p>
                      <p className={`font-bold tabular-nums ${bWon ? 'text-signal' : 'text-faint'}`}>
                        {formatSignedTokens(Number(m.b_payout) - Number(m.b_amount))}
                      </p>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
