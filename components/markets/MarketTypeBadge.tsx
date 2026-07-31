import { MARKET_TYPE_LABEL, MARKET_TYPE_ICON, type MarketType } from '@/lib/marketType';
import { cn } from '@/lib/cn';

/** A market's type (yes/no, over/under, multiple choice) used to be near-invisible outside the
    create-market form — inferable at best from the odds bar's side labels, or a "Multiple
    choice" pill shown only while pending_sponsor. This is the one shared badge for it, used
    consistently everywhere a market shows up (card, row, detail page) instead of type-specific
    one-off treatments. `cn` here is a plain class joiner, not tailwind-merge (see lib/cn.ts), so
    the two looks are separate variants rather than a base pill with color/padding overridden via
    className — conflicting utility classes in one string aren't guaranteed to resolve the way
    source order suggests. */
export function MarketTypeBadge({
  marketType,
  variant = 'pill',
  className,
}: {
  marketType: MarketType;
  /** 'pill': the default filled badge, for cards and the market detail page. 'plain': no
      background/padding, for tight list rows that already carry their own spacing. */
  variant?: 'pill' | 'plain';
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 text-[11px] font-bold tracking-wide uppercase',
        variant === 'pill' ? 'rounded-full bg-espresso-50 px-2.5 py-1 text-espresso-500' : 'text-espresso-400',
        className
      )}
    >
      <span aria-hidden className="text-espresso-400">
        {MARKET_TYPE_ICON[marketType]}
      </span>
      {MARKET_TYPE_LABEL[marketType]}
    </span>
  );
}
