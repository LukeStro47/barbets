'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { PlusIcon } from '@/components/ui/icons';
import { MARKET_TYPE_LABEL, MARKET_TYPE_DESCRIPTION, MARKET_TYPE_ICON, type MarketType } from '@/lib/marketType';
import { getActiveNavTab, getRouteGroupId, shouldHideBottomNav, type NavTab } from '@/lib/navRoute';
import { formatTokenInputValue } from '@/lib/formatNumber';
import { useKeyboardState } from '@/lib/useKeyboardInset';
import { cn } from '@/lib/cn';

export type NavGroup = { id: string; name: string; initials: string; meta: string };

const TABS: { key: NavTab; label: string }[] = [
  { key: 'home', label: 'Home' },
  { key: 'markets', label: 'Markets' },
  { key: 'board', label: 'Leaderboard' },
  { key: 'you', label: 'You' },
];

/** Five slots at 20% each; the plus button owns slot index 2. */
const SLOT: Record<NavTab, number> = { home: 0, markets: 1, board: 3, you: 4 };

const MARKET_TYPES: MarketType[] = ['yes_no', 'over_under', 'multiple_choice'];

function iconButtonClass(active: boolean, basis: 'basis-1/5' | 'basis-1/3') {
  return cn('relative flex h-full flex-none items-center justify-center border-0 bg-transparent p-0', basis, active && 'text-espresso-950');
}

type GlyphProps = { className?: string; strokeWidth: number };

function HomeGlyph({ className, strokeWidth }: GlyphProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M4 11.5 12 4l8 7.5M6 10v9h5v-5h2v5h5v-9" />
    </svg>
  );
}
function MarketsGlyph({ className, strokeWidth }: GlyphProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M3 17l5-5 3 3 6-7M14 8h5v5" />
    </svg>
  );
}
function BoardGlyph({ className, strokeWidth }: GlyphProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M8 20V11M14 20V4M20 20v-7M2 20h20" />
    </svg>
  );
}
function YouGlyph({ className, strokeWidth }: GlyphProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8c0-3.9 3.1-7 7-7s7 3.1 7 7" />
    </svg>
  );
}

const TAB_GLYPH: Record<NavTab, (props: GlyphProps) => React.ReactNode> = {
  home: HomeGlyph,
  markets: MarketsGlyph,
  board: BoardGlyph,
  you: YouGlyph,
};

/**
 * App-wide bottom navigation. Fixed to the viewport and mounted as a sibling of
 * PullToRefresh/PageTransition (see app/(app)/layout.tsx) — nesting it inside either would put
 * it under an ancestor that sometimes carries a CSS transform, which silently breaks
 * position:fixed (same issue PageTransition's own comment documents for BetslipBar).
 *
 * Route-aware by design rather than driven by props from each page: activeTab, the current
 * group, and whether to render at all are all derived from the pathname (lib/navRoute.ts) so
 * ~15 pages don't each need to thread nav state down manually.
 */
export function BottomNav({
  groups,
  bettingEnabledByGroup,
  hasNeedsYou = false,
}: {
  groups: NavGroup[];
  bettingEnabledByGroup: Record<string, boolean>;
  /** True when any of the viewer's groups has a market waiting on them (an endorsement, a
   * vote) — surfaced as a small red dot on the Home tab, since Home is where the switcher
   * (and from there, every group's own "N waiting on you" card) lives. */
  hasNeedsYou?: boolean;
}) {
  const pathname = usePathname();
  const router = useRouter();

  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [marketType, setMarketType] = useState<MarketType>('yes_no');
  const [bettingOffOpen, setBettingOffOpen] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [groupSeedAmount, setGroupSeedAmount] = useState('1,000');

  // position:fixed uses the *layout* viewport, which doesn't shrink when the on-screen keyboard
  // opens, so the tab bar would otherwise float on top of the keyboard instead of being covered
  // by it. Simplest correct fix: don't show it while a keyboard is up — there's no page to
  // switch tabs on while you're mid-type anyway.
  const { visible: keyboardOpen, inset: keyboardInset } = useKeyboardState();

  // Neither sheet is a normal in-flow page element, so nothing else stops a scroll or a
  // pull-to-refresh gesture on the (dimmed but still-present) page underneath — same lock
  // BetslipBar's own open sheet already uses, and the same signal PullToRefresh checks before
  // arming.
  useEffect(() => {
    if (!switcherOpen && !createOpen) return;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, [switcherOpen, createOpen]);

  // Reset any open sheet the moment the route actually changes, so navigating away (e.g. picking
  // a group) doesn't leave a sheet re-appearing stale on the next visible page.
  const prevPathnameRef = useRef(pathname);
  if (pathname !== prevPathnameRef.current) {
    prevPathnameRef.current = pathname;
    if (switcherOpen) setSwitcherOpen(false);
    if (createOpen) setCreateOpen(false);
  }

  const activeTab = getActiveNavTab(pathname);
  const groupId = getRouteGroupId(pathname);

  // Profile isn't nested under /groups/[id], so on its own it'd read as "no group in scope" and
  // collapse Markets/Board away — but arriving there from a group should still feel like you're
  // "in" that group, just looking at your profile for a moment. Updated inline during render
  // (not an effect) so this render already reflects it, same pattern prevPathnameRef below uses.
  // Visiting the all-groups hub is the one deliberate "I'm not in a group right now" signal, so
  // it clears the memory instead of leaving it stale.
  const lastGroupIdRef = useRef<string | null>(null);
  if (groupId) {
    lastGroupIdRef.current = groupId;
  } else if (pathname === '/groups') {
    lastGroupIdRef.current = null;
  }
  const effectiveGroupId = groupId ?? (pathname === '/profile' ? lastGroupIdRef.current : null);
  const currentGroup = effectiveGroupId ? groups.find((g) => g.id === effectiveGroupId) : undefined;
  const inGroup = !!currentGroup;

  if (shouldHideBottomNav(pathname)) return null;

  const openSwitcher = () => {
    setCreateOpen(false);
    setSwitcherOpen(true);
  };
  const toggleCreate = () => {
    if (createOpen) {
      setCreateOpen(false);
      return;
    }
    setSwitcherOpen(false);
    // Fail fast, same as NewMarketButton's own pre-check: no point walking through "pick a
    // type" only to be told betting's off on Continue.
    if (currentGroup && !bettingEnabledByGroup[currentGroup.id]) {
      setBettingOffOpen(true);
      return;
    }
    setCreateOpen(true);
  };

  function goToTab(tab: NavTab) {
    if (tab === 'home') {
      openSwitcher();
    } else if (tab === 'you') {
      // Carries the group you're currently in along to Profile, so it opens already scoped to
      // it instead of falling back to whichever group Profile defaults to on its own.
      router.push(currentGroup ? `/profile?group=${currentGroup.id}` : '/profile');
    } else if (tab === 'markets') {
      router.push(currentGroup ? `/groups/${currentGroup.id}` : '/groups?all=1');
    } else if (tab === 'board') {
      router.push(currentGroup ? `/groups/${currentGroup.id}/leaderboard` : '/groups?all=1');
    }
  }

  function selectGroup(id: string) {
    setSwitcherOpen(false);
    router.push(`/groups/${id}`);
  }

  function continueCreateMarket() {
    if (!currentGroup) return;
    setCreateOpen(false);
    router.push(`/groups/${currentGroup.id}/markets/new?type=${marketType}`);
  }

  function continueCreateGroup() {
    const name = groupName.trim();
    if (!name) return;
    setCreateOpen(false);
    const params = new URLSearchParams({ name, seedAmount: groupSeedAmount.replace(/,/g, '') || '1000' });
    router.push(`/groups/new?${params.toString()}`);
  }

  // Markets/Board only mean anything with a current group in scope — outside one (the
  // all-groups hub, /profile, admin/feedback, ...) the bar drops to three wide slots
  // (Home, +, You) instead of five cramped ones with two dead tabs in the middle.
  const totalSlots = inGroup ? 5 : 3;
  const slotPct = 100 / totalSlots;
  const activeSlot = !activeTab ? null : inGroup ? SLOT[activeTab] : activeTab === 'you' ? 2 : activeTab === 'home' ? 0 : null;
  const indicatorLeft = activeSlot !== null ? `calc(${activeSlot * slotPct}% + ${slotPct / 2}% - 11px)` : null;
  const plusLeftPct = inGroup ? 40 : slotPct;

  return (
    <>
      {bettingOffOpen && (
        <Modal onClose={() => setBettingOffOpen(false)}>
          <p className="font-display font-bold text-espresso-900">Betting is turned off</p>
          <p className="text-sm text-espresso-500">
            The group owner hasn't turned betting on yet. Once they do, everyone can start creating markets.
          </p>
          <Button className="w-full" onClick={() => setBettingOffOpen(false)}>
            Got it
          </Button>
        </Modal>
      )}

      {/* ---- Home: group switcher, floats above the bar ---- */}
      {switcherOpen && (
        <>
          <div
            onClick={() => setSwitcherOpen(false)}
            className="fixed inset-0 z-40 animate-bottomnav-scrim-in bg-espresso-950/40"
          />
          <div
            className="fixed right-3 left-3 z-40 origin-bottom-left animate-bottomnav-sheet-up rounded-3xl border border-espresso-100 bg-paper-white p-3 pt-3.5 shadow-[0_26px_46px_-22px_rgba(28,19,13,0.5)]"
            style={{ bottom: 'calc(var(--bottomnav-height) + 8px)' }}
          >
            <p className="mb-2.5 ml-1.5 text-[10.5px] font-extrabold tracking-[0.09em] text-espresso-400 uppercase">Your groups</p>
            <div className="flex flex-col gap-1">
              {groups.map((g) => {
                const current = inGroup && g.id === currentGroup!.id;
                return (
                  <button
                    key={g.id}
                    onClick={() => selectGroup(g.id)}
                    className={cn(
                      'flex w-full items-center gap-[11px] rounded-2xl border-[1.5px] px-[11px] py-2.5 text-left',
                      current ? 'border-honey-500 bg-honey-500/10' : 'border-transparent bg-transparent'
                    )}
                  >
                    <span className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[11px] bg-espresso-900 text-[11.5px] font-extrabold text-honey-300">
                      {g.initials}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13.5px] font-extrabold text-espresso-900">{g.name}</span>
                      <span className="block truncate text-[11px] text-espresso-400">{g.meta}</span>
                    </span>
                    {current && <span className="shrink-0 text-[11px] text-honey-600">●</span>}
                  </button>
                );
              })}
              {groups.length === 0 && <p className="px-1.5 py-2 text-sm text-espresso-400">No groups yet.</p>}
            </div>
            <button
              onClick={() => {
                setSwitcherOpen(false);
                router.push('/groups?all=1');
              }}
              className="mt-2 flex w-full items-center justify-between gap-2.5 border-0 border-t border-espresso-50 bg-transparent px-[11px] pt-[11px] pb-[3px] text-left"
            >
              <span className="text-[13px] font-extrabold text-honey-700">All groups</span>
              <span className="text-sm text-honey-600">›</span>
            </button>
          </div>
        </>
      )}

      {/* ---- Plus: contextual create sheet ---- */}
      {createOpen && (
        <>
          <div onClick={toggleCreate} className="fixed inset-0 z-40 animate-bottomnav-scrim-in bg-espresso-950/45" />
          <div
            className="fixed inset-x-0 bottom-0 z-40 animate-bottomnav-sheet-up rounded-t-[28px] bg-gradient-to-br from-espresso-900 via-espresso-700 to-espresso-700 px-5 pt-3.5 pb-[env(safe-area-inset-bottom)]"
            // Once the keyboard pushes this sheet up, the browser scrolls just far enough to
            // reveal the focused input — which leaves the Continue button sitting flush against
            // the keyboard with no breathing room. Pad past the keyboard height plus a bit extra
            // instead, only while it's actually open (undefined lets the class above win at rest).
            style={{ paddingBottom: keyboardOpen ? keyboardInset + 16 : undefined }}
          >
            <button onClick={toggleCreate} aria-label="Close" className="block w-full border-0 bg-transparent pb-[13px]">
              <span className="mx-auto block h-1 w-[38px] rounded-full bg-white/20" />
            </button>

            {inGroup ? (
              <>
                <p className="mb-0.5 font-display text-base font-extrabold tracking-[-0.01em] text-paper-white">New market</p>
                <p className="mb-3.5 text-xs text-paper-white/50">How should it settle?</p>
                <div className="mb-3.5 flex flex-col gap-1.5">
                  {MARKET_TYPES.map((t) => {
                    const on = marketType === t;
                    return (
                      <button
                        key={t}
                        onClick={() => setMarketType(t)}
                        className={cn(
                          'flex w-full items-center gap-3 rounded-2xl border-[1.5px] px-3.5 py-3 text-left transition-colors',
                          on ? 'border-honey-500 bg-honey-500' : 'border-white/15 bg-white/5'
                        )}
                      >
                        <span aria-hidden className={cn('text-xl', on ? 'text-espresso-900' : 'text-paper-white')}>
                          {MARKET_TYPE_ICON[t]}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className={cn('block text-[13.5px] font-extrabold', on ? 'text-espresso-900' : 'text-paper-white')}>
                            {MARKET_TYPE_LABEL[t]}
                          </span>
                          <span className={cn('block text-[11.5px] font-semibold', on ? 'text-espresso-900/60' : 'text-paper-white/50')}>
                            {MARKET_TYPE_DESCRIPTION[t]}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
                <div className="flex items-center gap-2.5 border-t border-white/10 pt-3.5">
                  <span className="min-w-0 flex-1">
                    <span className="block text-[10px] font-bold tracking-[0.07em] text-paper-white/40 uppercase">Posting to</span>
                    <span className="block truncate text-[13px] font-extrabold text-paper-white">{currentGroup!.name}</span>
                  </span>
                  <button
                    onClick={continueCreateMarket}
                    className="shrink-0 rounded-full border-0 bg-honey-500 px-[18px] py-2.5 text-[12.5px] font-extrabold text-espresso-900"
                  >
                    Continue
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="mb-0.5 font-display text-base font-extrabold tracking-[-0.01em] text-paper-white">New group</p>
                <p className="mb-3.5 text-xs text-paper-white/50">A private table, everyone starts even.</p>
                <div className="mb-3.5 flex flex-col gap-2">
                  <div className="rounded-2xl border-[1.5px] border-white/15 bg-white/5 px-[15px] py-3">
                    <label className="block text-[10px] font-bold tracking-[0.07em] text-paper-white/40 uppercase">Group name</label>
                    <input
                      value={groupName}
                      onChange={(e) => setGroupName(e.target.value)}
                      placeholder="The Wednesday Wagers"
                      className="mt-[3px] block w-full border-0 bg-transparent p-0 text-sm font-bold text-paper-white placeholder:text-paper-white/30 focus:outline-none"
                    />
                  </div>
                  <div className="rounded-2xl border-[1.5px] border-white/15 bg-white/5 px-[15px] py-3">
                    <label className="block text-[10px] font-bold tracking-[0.07em] text-paper-white/40 uppercase">Token allocation</label>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={groupSeedAmount}
                      onChange={(e) => setGroupSeedAmount(formatTokenInputValue(e.target.value))}
                      className="mt-[3px] block w-full border-0 bg-transparent p-0 text-sm font-bold text-paper-white focus:outline-none"
                    />
                  </div>
                </div>
                <button
                  onClick={continueCreateGroup}
                  disabled={!groupName.trim()}
                  className="w-full rounded-full border-0 bg-honey-500 py-2.5 text-[12.5px] font-extrabold text-espresso-900 disabled:opacity-40"
                >
                  Continue
                </button>
              </>
            )}
          </div>
        </>
      )}

      {/* ---- The bar ---- */}
      {!keyboardOpen && (
      <nav
        className="fixed inset-x-0 bottom-0 z-30 border-t border-espresso-100 bg-paper-white pb-[max(20px,env(safe-area-inset-bottom))]"
      >
        <div className="relative flex h-[60px] items-center">
          {indicatorLeft && (
            <span
              aria-hidden
              className="absolute -top-px h-[3px] w-[22px] rounded-b-[3px] bg-honey-600 transition-[left] duration-[460ms] ease-[cubic-bezier(0.34,1.3,0.5,1)] motion-reduce:transition-none"
              style={{ left: indicatorLeft }}
            />
          )}
          {inGroup ? (
            <>
              {TABS.slice(0, 2).map((t) => {
                const Glyph = TAB_GLYPH[t.key];
                const active = activeTab === t.key;
                return (
                  <button key={t.key} aria-label={t.label} aria-current={active ? 'page' : undefined} onClick={() => goToTab(t.key)} className={iconButtonClass(active, 'basis-1/5')}>
                    <span className="relative">
                      <Glyph strokeWidth={active ? 2.3 : 1.9} className={cn('h-[23px] w-[23px]', !active && 'text-espresso-300')} />
                      {t.key === 'home' && hasNeedsYou && (
                        <span className="absolute top-0 right-0 h-2 w-2 rounded-full border-2 border-paper-white bg-danger-500" />
                      )}
                    </span>
                  </button>
                );
              })}
              <span className="basis-1/5" />
              {TABS.slice(2).map((t) => {
                const Glyph = TAB_GLYPH[t.key];
                const active = activeTab === t.key;
                return (
                  <button key={t.key} aria-label={t.label} aria-current={active ? 'page' : undefined} onClick={() => goToTab(t.key)} className={iconButtonClass(active, 'basis-1/5')}>
                    <Glyph strokeWidth={active ? 2.3 : 1.9} className={cn('h-[23px] w-[23px]', !active && 'text-espresso-300')} />
                  </button>
                );
              })}
            </>
          ) : (
            <>
              {(['home', null, 'you'] as const).map((key) =>
                key === null ? (
                  <span key="spacer" className="basis-1/3" />
                ) : (
                  (() => {
                    const t = TABS.find((tab) => tab.key === key)!;
                    const Glyph = TAB_GLYPH[key];
                    const active = activeTab === key;
                    return (
                      <button key={key} aria-label={t.label} aria-current={active ? 'page' : undefined} onClick={() => goToTab(key)} className={iconButtonClass(active, 'basis-1/3')}>
                        <span className="relative">
                          <Glyph strokeWidth={active ? 2.3 : 1.9} className={cn('h-[23px] w-[23px]', !active && 'text-espresso-300')} />
                          {key === 'home' && hasNeedsYou && (
                            <span className="absolute top-0 right-0 h-2 w-2 rounded-full border-2 border-paper-white bg-danger-500" />
                          )}
                        </span>
                      </button>
                    );
                  })()
                )
              )}
            </>
          )}
          <button
            onClick={toggleCreate}
            aria-label={inGroup ? 'New market' : 'New group'}
            aria-expanded={createOpen}
            className="absolute top-0 flex h-full items-center justify-center border-0 bg-transparent p-0"
            style={{ left: `${plusLeftPct}%`, width: `${slotPct}%` }}
          >
            <span
              className={cn(
                'flex h-[46px] w-[46px] items-center justify-center rounded-full bg-espresso-900 transition-transform duration-[380ms] ease-[cubic-bezier(0.34,1.56,0.64,1)] motion-reduce:transition-none',
                createOpen && 'rotate-45'
              )}
            >
              <PlusIcon className="h-[19px] w-[19px] text-honey-300" />
            </span>
          </button>
        </div>
      </nav>
      )}
    </>
  );
}
