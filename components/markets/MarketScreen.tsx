import Link from 'next/link';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { formatTokens } from '@/lib/formatNumber';
import { Mention } from '@/components/ui/Mention';
import { OptionLabel } from '@/components/markets/OptionLabel';

/**
 * The pieces every market-page state (4d/4e/4h/4h2/4h3/4n) is assembled from. Kept in one file
 * because they only make sense together: the header's status chip, the title block with its
 * Market/Comments tabs, the 4d dark position box, the criteria card, the "What happens next"
 * card, and 4n's closed-odds card.
 */

/** The header's right-hand status chip. Open is a quiet tile chip (4d/4h); every state past
 *  betting is an ink chip (4m "Settled", 4n "Closed") so "this is over" reads at a glance. */
export function StatusChip({ label, tone }: { label: string; tone: 'quiet' | 'ink' }) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center rounded-lg px-2.5 py-[5px] text-[11.5px] font-bold',
        tone === 'ink' ? 'bg-ink text-surface' : 'border border-hairline bg-tile text-ink'
      )}
    >
      {label}
    </span>
  );
}

/** The Market / Comments tab pair: 13.5px, a 2px ink underline on the active one. */
export function MarketTabs({
  groupId,
  marketId,
  active,
  commentCount,
  className,
}: {
  groupId: string;
  marketId: string;
  active: 'market' | 'comments';
  commentCount: number;
  className?: string;
}) {
  const base = `/groups/${groupId}/markets/${marketId}`;
  return (
    <div className={cn('flex gap-[22px]', className)}>
      <Link
        href={base}
        replace
        className={cn('pb-2.5 text-[13.5px]', active === 'market' ? 'font-bold text-ink shadow-[inset_0_-2px_0_var(--color-ink)]' : 'font-semibold text-faint')}
      >
        Market
      </Link>
      <Link
        href={`${base}?tab=comments`}
        replace
        className={cn(
          'inline-flex items-center gap-1.5 pb-2.5 text-[13.5px]',
          active === 'comments' ? 'font-bold text-ink shadow-[inset_0_-2px_0_var(--color-ink)]' : 'font-semibold text-faint'
        )}
      >
        Comments <span className="font-mono text-[12px] text-faint">{commentCount}</span>
      </Link>
    </div>
  );
}

/** Title, one grey line under it, then the tabs on a hairline — the top of 4d/4h/4m/4n. */
export function MarketTitleBlock({
  title,
  subtitle,
  size = 22,
  tabs,
}: {
  title: string;
  subtitle?: ReactNode;
  size?: 22 | 23;
  /** Omitted only by the subject's sealed view, which has no Comments tab to offer. */
  tabs?: ReactNode;
}) {
  return (
    <div>
      <h1
        className="leading-[1.2] font-extrabold tracking-[-0.022em] text-ink text-pretty"
        style={{ fontSize: size }}
      >
        {title}
      </h1>
      {subtitle && <p className="mt-1.5 text-[12.5px] text-faint">{subtitle}</p>}
      {tabs && <div className="mt-[13px] border-b border-hairline">{tabs}</div>}
    </div>
  );
}

/** 4d's "Your position": a flat ink box, the stake in mono and the side as a translucent chip.
 *  A hedge gets one line per side rather than a sum that would hide it. */
export function PositionBox({ rows }: { rows: { key: string; label: string; amount: number }[] }) {
  return (
    <div className="rounded-[20px] bg-ink px-[18px] py-[15px]">
      <span className="block text-[10.5px] font-bold tracking-[0.1em] whitespace-nowrap text-surface/50 uppercase">Your position</span>
      <div className="mt-1.5 flex flex-col gap-2">
        {rows.map((r) => (
          <div key={r.key} className="flex items-end justify-between gap-3">
            <span className="font-mono text-[28px] leading-none font-semibold text-surface">{formatTokens(r.amount)}</span>
            <span className="max-w-[60%] truncate rounded-[10px] bg-white/12 px-3.5 py-2 text-[14px] font-bold text-surface">
              <OptionLabel label={sideTitle(r.label)} />
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** "YES" -> "Yes", "OVER" -> "Over"; option labels pass through untouched. */
export function sideTitle(label: string): string {
  const lower = label.toLowerCase();
  if (lower === 'yes' || lower === 'no' || lower === 'over' || lower === 'under') return lower.charAt(0).toUpperCase() + lower.slice(1);
  return label;
}

/** 4d's "Resolution criteria" / 4h's "How it settles": eyebrow and the Question-this pill on one
 *  row, the criteria underneath. `children` carries ClarificationRequests (pill + any pending
 *  questions), which positions its pill into this card's top-right corner. */
export function CriteriaCard({
  label,
  description,
  subjects,
  note,
  compact,
  children,
}: {
  label: string;
  description: string;
  subjects?: string[];
  note?: ReactNode;
  /** 4h's smaller 16px-radius variant (under a bet card) vs 4d's 20px one. */
  compact?: boolean;
  children?: ReactNode;
}) {
  return (
    <div className={cn('relative border border-hairline bg-surface', compact ? 'rounded-2xl px-[15px] py-3' : 'rounded-[20px] px-[18px] py-3.5')}>
      <p className="max-w-[calc(100%-118px)] py-[3px] text-[10.5px] font-bold tracking-[0.1em] whitespace-nowrap text-faint uppercase">{label}</p>
      <p className={cn('mt-1.5 leading-[1.5] text-muted text-pretty', compact ? 'text-[12.5px]' : 'text-[13.5px]')}>{description}</p>
      {subjects && subjects.length > 0 && (
        <p className="mt-2.5 inline-flex flex-wrap items-center gap-1 rounded-full bg-tile px-2.5 py-1 text-[12px] font-medium text-muted">
          <span className="text-faint">Hidden from</span>
          {subjects.map((n, i) => (
            <span key={i}>
              {i > 0 && ', '}
              <Mention nickname={n} />
            </span>
          ))}
        </p>
      )}
      {note && <p className="mt-2.5 text-[11.5px] leading-[1.45] text-faint">{note}</p>}
      {children}
    </div>
  );
}

export interface NextStep {
  title: ReactNode;
  sub?: ReactNode;
  state: 'done' | 'current' | 'upcoming';
}

/**
 * "What happens next" (4d/4h/4n): each step a bold title and one faint line under it, matching
 * the mock's copy structure. The marker is the dot-on-a-rail the app already used (a confirmed
 * keep over the mock's numbered chips, for consistency with ConsequenceRow) — hollow for ahead,
 * signal for the current step, ink for done. `children` is the stage's one action, under a rule.
 */
export function NextStepsCard({ steps, heading = 'What happens next', children }: { steps: NextStep[]; heading?: string; children?: ReactNode }) {
  return (
    <div className="rounded-[20px] border border-hairline bg-surface px-[18px] pt-3.5 pb-1.5">
      <p className="mb-1 text-[10.5px] font-bold tracking-[0.1em] text-faint uppercase">{heading}</p>
      {steps.map((s, i) => {
        const last = i === steps.length - 1;
        return (
          <div key={i} className="flex gap-[11px] border-t border-rule py-[11px]">
            <span className="flex w-5 shrink-0 justify-center pt-[5px]">
              <span
                className={cn(
                  'h-2 w-2 rounded-full',
                  s.state === 'current' ? 'bg-signal' : s.state === 'done' ? 'bg-ink' : 'border-[1.5px] border-dash bg-surface'
                )}
              />
            </span>
            <span className={cn('min-w-0 flex-1', last && !children && 'pb-0')}>
              <span className={cn('block text-[13px] font-bold', s.state === 'done' ? 'text-faint' : 'text-ink')}>{s.title}</span>
              {s.sub && <span className="mt-px block text-[12px] leading-[1.45] text-faint">{s.sub}</span>}
            </span>
          </div>
        );
      })}
      {children && <div className="border-t border-rule pt-3 pb-2.5">{children}</div>}
    </div>
  );
}

export interface ClosedOddsSide {
  key: string;
  label: string;
  percent: number;
  staked: number;
}

/**
 * 4n's "Odds" card: the line chip (over/under), the pool, a two-tone split bar, then one tile per
 * side with its percentage and stake — the viewer's own side outlined in signal. Multiple choice
 * gets one tile per option in a column instead of a two-up row.
 */
export function ClosedOddsCard({
  sides,
  pool,
  lineLabel,
  mySideKey,
  note,
}: {
  sides: ClosedOddsSide[];
  pool: number;
  lineLabel?: string;
  mySideKey?: string;
  note?: ReactNode;
}) {
  const twoWay = sides.length === 2;
  return (
    <div className="rounded-[20px] border border-hairline bg-surface px-[15px] pt-3.5 pb-[15px]">
      <div className="flex items-center justify-between gap-2.5">
        <p className="text-[15px] font-extrabold tracking-[-0.01em] text-ink">Odds</p>
        {lineLabel && (
          <span className="inline-flex items-center gap-1.5 rounded-lg border border-hairline bg-tile px-[9px] py-1 whitespace-nowrap">
            <span className="text-[10px] font-bold tracking-[0.08em] text-faint uppercase">Line</span>
            <span className="font-mono text-[12.5px] font-semibold text-ink">{lineLabel}</span>
          </span>
        )}
      </div>
      <p className="mt-[7px] font-mono text-[11.5px] text-faint">{formatTokens(pool)} in the pool</p>
      {twoWay && (
        <div className="mt-[11px] flex h-[34px] overflow-hidden rounded-[10px]">
          {sides.map((s, i) => (
            <span
              key={s.key}
              className={cn(
                'flex items-center font-mono text-[12.5px] font-semibold text-surface',
                i === 0 ? 'bg-ink pl-[11px]' : 'justify-end bg-signal pr-[11px]'
              )}
              style={{ width: `${s.percent}%` }}
            >
              {s.percent >= 12 ? `${s.percent}%` : ''}
            </span>
          ))}
        </div>
      )}
      <div className={cn('mt-[9px] flex gap-[9px]', !twoWay && 'flex-col')}>
        {sides.map((s) => {
          const mine = s.key === mySideKey;
          return (
            <div
              key={s.key}
              className={cn('flex-1 rounded-[15px] border-[1.5px] px-3.5 py-[13px]', mine ? 'border-signal bg-signal-wash' : 'border-hairline bg-surface')}
            >
              <p className="text-[13px] leading-[1.3] font-bold text-ink text-pretty">
                <OptionLabel label={s.label} />
              </p>
              <p className={cn('mt-2 font-mono text-[27px] leading-none font-semibold tracking-[-0.02em]', mine ? 'text-signal' : 'text-ink')}>{s.percent}%</p>
              <p className="mt-[5px] font-mono text-[11px] text-faint">{formatTokens(s.staked)} staked</p>
            </div>
          );
        })}
      </div>
      {note && <p className="mt-2.5 text-[12px] leading-[1.5] text-faint text-pretty">{note}</p>}
    </div>
  );
}

/** 4n's "Your bet" ink card: stake and side on the left, what it pays if right on the right. */
export function ClosedBetBox({ amount, label, pays }: { amount: number; label: string; pays: number | null }) {
  return (
    <div className="flex items-end justify-between gap-3 rounded-[20px] bg-ink px-[18px] py-4">
      <span className="min-w-0">
        <span className="block text-[10.5px] font-bold tracking-[0.1em] text-surface/50 uppercase">Your bet</span>
        <span className="mt-1.5 block font-mono text-[28px] leading-none font-semibold text-surface">{formatTokens(amount)}</span>
        <span className="mt-[5px] block truncate text-[13px] font-bold text-surface">
          on <OptionLabel label={label} />
        </span>
      </span>
      {pays != null && (
        <span className="shrink-0 text-right">
          <span className="block text-[11px] font-semibold text-surface/50">Pays if you&apos;re right</span>
          <span className="mt-[5px] block font-mono text-[20px] font-semibold text-on-ink">{formatTokens(pays)}</span>
        </span>
      )}
    </div>
  );
}
