'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { PlusIcon, ChevronRightIcon } from '@/components/ui/icons';
import { MARKET_TYPE_LABEL, MARKET_TYPE_DESCRIPTION, MARKET_TYPE_ICON, type MarketType } from '@/lib/marketType';
import { getActiveNavTab, getRouteGroupId, shouldHideBottomNav, type NavTab } from '@/lib/navRoute';
import { formatTokenInputValue } from '@/lib/formatNumber';
import { GROUP_NAME_MAX_LENGTH, TOKEN_ALLOCATION_MAX } from '@/lib/limits';
import { useKeyboardState } from '@/lib/useKeyboardInset';
import { cn } from '@/lib/cn';
import { GroupAvatar } from '@/components/ui/GroupAvatar';
import { NEW_GROUP_EVENT } from '@/components/groups/StartGroupButton';

export type NavGroup = { id: string; name: string; avatarKey: string | null; meta: string };

/** Why the "+" create-market button is blocked for a group, if it is — distinct reasons because
 * they need distinct copy: an owner-off group can be turned on any time by the owner, a
 * between-seasons group is waiting on the owner to continue, and a winding-down one just needs
 * its last few markets to finish resolving. */
export interface GroupBettingStatus {
  blocked: boolean;
  reason?: 'owner_off' | 'season_intermission' | 'season_winding_down' | 'not_moderator';
  ownerNickname?: string;
  seasonName?: string;
}

const TABS: { key: NavTab; label: string }[] = [
  { key: 'markets', label: 'Markets' },
  { key: 'inbox', label: 'Inbox' },
  { key: 'group', label: 'Group' },
  { key: 'you', label: 'You' },
];

/** Five slots at 20% each; the plus button owns slot index 2. */
const SLOT: Record<NavTab, number> = { markets: 0, inbox: 1, group: 3, you: 4 };

const MARKET_TYPES: MarketType[] = ['yes_no', 'over_under', 'multiple_choice'];

function iconButtonClass(active: boolean, basis: 'basis-1/5' | 'basis-1/3') {
  return cn('relative flex h-full flex-none items-center justify-center border-0 bg-transparent p-0', basis, active && 'text-ink');
}

type GlyphProps = { className?: string; strokeWidth: number };

function MarketsGlyph({ className, strokeWidth }: GlyphProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M3 17l5-5 3 3 6-7M14 8h5v5" />
    </svg>
  );
}
function InboxGlyph({ className, strokeWidth }: GlyphProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M4 6h16v12H4zM4 10l8 5 8-5" />
    </svg>
  );
}
function GroupGlyph({ className, strokeWidth }: GlyphProps) {
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
  markets: MarketsGlyph,
  inbox: InboxGlyph,
  group: GroupGlyph,
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
  bettingStatusByGroup,
  hasNeedsYou = false,
}: {
  groups: NavGroup[];
  bettingStatusByGroup: Record<string, GroupBettingStatus>;
  /** True when any of the viewer's groups has a market waiting on them (an endorsement, a
   * vote) — surfaced as a badge on the Inbox tab. */
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

  // The groups hub's "Start a group" button opens this drawer rather than owning a second copy of
  // it — one place collects a name and an allocation, whichever affordance you came in through.
  // Safe to open unconditionally: the only dispatcher lives on /groups, where `inGroup` is always
  // false, so the sheet below always renders its "New group" side.
  useEffect(() => {
    const onNewGroup = () => {
      setSwitcherOpen(false);
      setCreateOpen(true);
    };
    window.addEventListener(NEW_GROUP_EVENT, onNewGroup);
    return () => window.removeEventListener(NEW_GROUP_EVENT, onNewGroup);
  }, []);

  // The demo walkthrough's post-tour "Create a Group" CTA lives on /demo, outside this layout, so
  // it can't dispatch NEW_GROUP_EVENT the way StartGroupButton does — nothing would be mounted to
  // hear it yet. It instead lands here with ?startGroup=1 and this opens the same drawer once, on
  // mount, then strips the flag so a refresh or a back-nav doesn't reopen it. Read straight off
  // `window.location` rather than `useSearchParams()` so this client component doesn't force a
  // Suspense boundary onto every page the nav renders in.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('startGroup') !== '1') return;
    setSwitcherOpen(false);
    setCreateOpen(true);
    params.delete('startGroup');
    const newSearch = params.toString();
    router.replace(`${window.location.pathname}${newSearch ? `?${newSearch}` : ''}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  // Profile and Inbox aren't nested under /groups/[id], so on their own they'd read as
  // "no group in scope". Arriving there from a group should still feel like you're in that
  // group. Visiting the all-groups hub is the one deliberate clear signal.
  const lastGroupIdRef = useRef<string | null>(null);
  if (groupId) {
    lastGroupIdRef.current = groupId;
  } else if (pathname === '/groups') {
    lastGroupIdRef.current = null;
  }
  const rememberGroup = pathname === '/profile' || pathname.startsWith('/profile/') || pathname === '/inbox';
  const effectiveGroupId = groupId ?? (rememberGroup ? lastGroupIdRef.current : null);
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
    if (currentGroup && bettingStatusByGroup[currentGroup.id]?.blocked) {
      setBettingOffOpen(true);
      return;
    }
    setCreateOpen(true);
  };

  function goToTab(tab: NavTab) {
    if (tab === 'inbox') {
      router.push('/inbox');
    } else if (tab === 'you') {
      router.push(currentGroup ? `/profile?group=${currentGroup.id}` : '/profile');
    } else if (tab === 'markets') {
      router.push(currentGroup ? `/groups/${currentGroup.id}` : '/groups?all=1');
    } else if (tab === 'group') {
      // Group section defaults to the leaderboard (DESIGN 4f). Long-press / switcher via group bar.
      if (currentGroup) {
        router.push(`/groups/${currentGroup.id}/leaderboard`);
      } else if (groups.length === 0) {
        router.push('/groups?all=1');
      } else {
        openSwitcher();
      }
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

  function browseTemplates() {
    if (!currentGroup) return;
    setCreateOpen(false);
    router.push(`/groups/${currentGroup.id}/markets/templates`);
  }

  function continueCreateGroup() {
    const name = groupName.trim();
    if (!name) return;
    setCreateOpen(false);
    const params = new URLSearchParams({ name, seedAmount: groupSeedAmount.replace(/,/g, '') || '1000' });
    router.push(`/groups/new?${params.toString()}`);
  }

  // Always five slots: Markets · Inbox · + · Group · You (DESIGN.md).
  const totalSlots = 5;
  const slotPct = 100 / totalSlots;
  const activeSlot = activeTab ? SLOT[activeTab] : null;
  const indicatorLeft = activeSlot !== null ? `calc(${activeSlot * slotPct}% + ${slotPct / 2}% - 11px)` : null;
  const plusLeftPct = 40;
  const bettingStatus = currentGroup ? bettingStatusByGroup[currentGroup.id] : undefined;
  const bettingOff = !!bettingStatus?.blocked;

  return (
    <>
      {bettingOffOpen && (
        <Modal onClose={() => setBettingOffOpen(false)}>
          <p className="font-display font-bold text-ink">
            {bettingStatus?.reason === 'season_intermission'
              ? 'Betting is closed between seasons'
              : bettingStatus?.reason === 'season_winding_down'
                ? 'No new markets right now'
                : bettingStatus?.reason === 'not_moderator'
                  ? 'Only moderators can start a market here'
                  : 'Betting is turned off'}
          </p>
          <p className="text-sm text-muted">
            {bettingStatus?.reason === 'season_intermission' ? (
              <>
                This season is done and the next one hasn&apos;t started yet.
                {bettingStatus.ownerNickname && ` Once @${bettingStatus.ownerNickname} continues the group and opens betting, everyone can create markets again.`}
              </>
            ) : bettingStatus?.reason === 'season_winding_down' ? (
              `No new markets while ${bettingStatus.seasonName ?? 'the season'} finishes resolving.`
            ) : bettingStatus?.reason === 'not_moderator' ? (
              'This is a public group, so market creation is limited to its moderators to keep the auto-generated schedule tidy.'
            ) : (
              "The group owner hasn't turned betting on yet. Once they do, everyone can start creating markets."
            )}
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
            className="fixed inset-0 z-40 animate-bottomnav-scrim-in bg-ink/40"
          />
          <div
            className="fixed right-3 left-3 z-40 origin-bottom-left animate-bottomnav-sheet-up rounded-3xl border border-hairline bg-surface p-3 pt-3.5 shadow-[0_26px_46px_-22px_rgba(28,19,13,0.5)]"
            style={{ bottom: 'calc(var(--bottomnav-height) + 8px)' }}
          >
            <p className="mb-2.5 ml-1.5 text-[10.5px] font-extrabold tracking-[0.09em] text-faint uppercase">Your groups</p>
            <div className="flex flex-col gap-1">
              {groups.map((g) => {
                const current = inGroup && g.id === currentGroup!.id;
                return (
                  <button
                    key={g.id}
                    onClick={() => selectGroup(g.id)}
                    className={cn(
                      'flex w-full items-center gap-[11px] rounded-2xl border-[1.5px] px-[11px] py-2.5 text-left',
                      current ? 'border-signal bg-signal/10' : 'border-transparent bg-transparent'
                    )}
                  >
                    <GroupAvatar
                      name={g.name}
                      avatarKey={g.avatarKey}
                      className="h-[34px] w-[34px] text-[11.5px]"
                      fallbackClassName="bg-ink text-on-ink"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13.5px] font-extrabold text-ink">{g.name}</span>
                      <span className="block truncate text-[11px] text-faint">{g.meta}</span>
                    </span>
                    {current && <span className="shrink-0 text-[11px] text-signal">●</span>}
                  </button>
                );
              })}
              {groups.length === 0 && <p className="px-1.5 py-2 text-sm text-faint">No groups yet.</p>}
            </div>
            <button
              onClick={() => {
                setSwitcherOpen(false);
                router.push('/groups?all=1');
              }}
              className="mt-2 flex w-full items-center justify-between gap-2.5 border-0 border-t border-rule bg-transparent px-[11px] pt-[11px] pb-[3px] text-left"
            >
              <span className="text-[13px] font-extrabold text-signal">All groups</span>
              <ChevronRightIcon className="h-3.5 w-2 shrink-0 text-signal" />
            </button>
          </div>
        </>
      )}

      {/* ---- Plus: contextual create sheet ---- */}
      {createOpen && (
        <>
          <div onClick={toggleCreate} className="fixed inset-0 z-40 animate-bottomnav-scrim-in bg-ink/45" />
          <div
            className="fixed inset-x-0 bottom-0 z-40 animate-bottomnav-sheet-up rounded-t-[28px] bg-gradient-to-br from-ink via-ink to-ink px-5 pt-3.5 pb-[env(safe-area-inset-bottom)]"
            // Once the keyboard pushes this sheet up, the browser scrolls just far enough to
            // reveal the focused input — which leaves the Continue button sitting flush against
            // the keyboard with no breathing room. Add the keyboard's height to the sheet's normal
            // floor rather than replacing it: `keyboardOpen` is focus-driven and `keyboardInset`
            // reads ~0 on the WebViews that shrink the layout viewport, so a plain override drops
            // the sheet below its resting position for as long as the field holds focus. Same fix
            // as BetslipBar's drawer.
            style={{
              paddingBottom: keyboardOpen && keyboardInset > 0 ? `calc(env(safe-area-inset-bottom) + ${keyboardInset + 16}px)` : undefined,
            }}
          >
            <button onClick={toggleCreate} aria-label="Close" className="block w-full border-0 bg-transparent pb-[13px]">
              <span className="mx-auto block h-1 w-[38px] rounded-full bg-white/20" />
            </button>

            {inGroup ? (
              <>
                <p className="mb-0.5 font-display text-base font-extrabold tracking-[-0.01em] text-white">New market</p>
                <p className="mb-3.5 text-xs text-white/50">How should it settle?</p>
                <div className="mb-3.5 flex flex-col gap-1.5">
                  {MARKET_TYPES.map((t) => {
                    const on = marketType === t;
                    return (
                      <button
                        key={t}
                        onClick={() => setMarketType(t)}
                        className={cn(
                          'flex w-full items-center gap-3 rounded-2xl border-[1.5px] px-3.5 py-3 text-left transition-colors',
                          on ? 'border-signal bg-signal' : 'border-white/15 bg-white/5'
                        )}
                      >
                        <span aria-hidden className={cn('text-xl', on ? 'text-ink' : 'text-white')}>
                          {MARKET_TYPE_ICON[t]}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className={cn('block text-[13.5px] font-extrabold', on ? 'text-ink' : 'text-white')}>
                            {MARKET_TYPE_LABEL[t]}
                          </span>
                          <span className={cn('block text-[11.5px] font-semibold', on ? 'text-ink/60' : 'text-white/50')}>
                            {MARKET_TYPE_DESCRIPTION[t]}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                  <button
                    onClick={browseTemplates}
                    className="flex w-full items-center gap-3 rounded-2xl border-[1.5px] border-dashed border-white/25 bg-transparent px-3.5 py-3 text-left"
                  >
                    <svg aria-hidden className="h-5 w-5 shrink-0 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 3l1.8 4.6L18 9l-4.2 1.4L12 15l-1.8-4.6L6 9l4.2-1.4L12 3z" />
                      <path d="M19 15l0.9 2.3L22 18l-2.1 0.7L19 21l-0.9-2.3L16 18l2.1-0.7L19 15z" />
                    </svg>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13.5px] font-extrabold text-white">Browse templates</span>
                      <span className="block text-[11.5px] font-semibold text-white/50">Start from a ready-made idea</span>
                    </span>
                  </button>
                </div>
                <div className="flex items-center gap-2.5 border-t border-white/10 pt-3.5">
                  <span className="min-w-0 flex-1">
                    <span className="block text-[10px] font-bold tracking-[0.07em] text-white/40 uppercase">Posting to</span>
                    <span className="block truncate text-[13px] font-extrabold text-white">{currentGroup!.name}</span>
                  </span>
                  <button
                    onClick={continueCreateMarket}
                    className="shrink-0 rounded-[14px] border-0 bg-signal px-[18px] py-2.5 text-[12.5px] font-extrabold text-white shadow-[var(--elevation-cta)]"
                  >
                    Continue
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="mb-0.5 font-display text-base font-extrabold tracking-[-0.01em] text-white">New group</p>
                <p className="mb-3.5 text-xs text-white/50">A private table, everyone starts even.</p>
                <div className="mb-3.5 flex flex-col gap-2">
                  <div className="rounded-2xl border-[1.5px] border-white/15 bg-white/5 px-[15px] py-3">
                    <label className="block text-[10px] font-bold tracking-[0.07em] text-white/40 uppercase">Group name</label>
                    <input
                      value={groupName}
                      onChange={(e) => setGroupName(e.target.value)}
                      placeholder="The Wednesday Wagers"
                      maxLength={GROUP_NAME_MAX_LENGTH}
                      className="mt-[3px] block w-full border-0 bg-transparent p-0 text-sm font-bold text-white placeholder:text-white/30 focus:outline-none"
                    />
                  </div>
                  <div className="rounded-2xl border-[1.5px] border-white/15 bg-white/5 px-[15px] py-3">
                    <label className="block text-[10px] font-bold tracking-[0.07em] text-white/40 uppercase">Token allocation</label>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={groupSeedAmount}
                      onChange={(e) => setGroupSeedAmount(formatTokenInputValue(e.target.value, TOKEN_ALLOCATION_MAX))}
                      className="mt-[3px] block w-full border-0 bg-transparent p-0 text-sm font-bold text-white focus:outline-none"
                    />
                  </div>
                </div>
                <button
                  onClick={continueCreateGroup}
                  disabled={!groupName.trim()}
                  className="w-full rounded-[14px] border-0 bg-signal py-[15px] text-[15px] font-bold text-white shadow-[var(--elevation-cta)] disabled:bg-disabled-bg disabled:text-disabled-ink disabled:shadow-none"
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
        className="fixed inset-x-0 bottom-0 z-30 border-t border-hairline bg-surface/96 pb-[max(20px,env(safe-area-inset-bottom))] shadow-[var(--elevation-sheet)] backdrop-blur-[8px]"
      >
        <div className="relative mx-auto flex h-[62px] max-w-[430px] items-center">
          {indicatorLeft && (
            <span
              aria-hidden
              className="absolute bottom-[8px] h-[3px] w-[22px] rounded-full bg-signal transition-[left] duration-150 ease-out motion-reduce:transition-none"
              style={{ left: indicatorLeft }}
            />
          )}
          {TABS.slice(0, 2).map((t) => {
            const Glyph = TAB_GLYPH[t.key];
            const active = activeTab === t.key;
            return (
              <button
                key={t.key}
                aria-label={t.label}
                aria-current={active ? 'page' : undefined}
                onClick={() => goToTab(t.key)}
                className={iconButtonClass(active, 'basis-1/5')}
              >
                <span className="relative flex flex-col items-center gap-0.5">
                  <Glyph strokeWidth={active ? 2.1 : 1.9} className={cn('h-[19px] w-[19px]', active ? 'text-signal' : 'text-faint')} />
                  <span className={cn('text-[10px] font-bold', active ? 'text-signal' : 'text-faint font-semibold')}>{t.label}</span>
                  {t.key === 'inbox' && hasNeedsYou && (
                    <span className="absolute -top-[3px] right-[14px] flex h-[15px] min-w-[15px] items-center justify-center rounded-full bg-alert px-1 text-[9.5px] font-bold text-white">
                      !
                    </span>
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
              <button
                key={t.key}
                aria-label={t.label}
                aria-current={active ? 'page' : undefined}
                onClick={() => goToTab(t.key)}
                className={iconButtonClass(active, 'basis-1/5')}
              >
                <span className="flex flex-col items-center gap-0.5">
                  <Glyph strokeWidth={active ? 2.1 : 1.9} className={cn('h-[19px] w-[19px]', active ? 'text-signal' : 'text-faint')} />
                  <span className={cn('text-[10px] font-bold', active ? 'text-signal' : 'text-faint font-semibold')}>{t.label}</span>
                </span>
              </button>
            );
          })}
          <button
            onClick={toggleCreate}
            aria-label={inGroup ? 'New market' : 'New group'}
            aria-expanded={createOpen}
            className="absolute top-0 flex h-full items-center justify-center border-0 bg-transparent p-0"
            style={{ left: `${plusLeftPct}%`, width: `${slotPct}%` }}
          >
            <span
              className={cn(
                'flex h-[42px] w-[42px] items-center justify-center rounded-[14px] bg-ink transition-transform duration-150 ease-out motion-reduce:transition-none',
                createOpen && 'rotate-45',
                bettingOff && inGroup && 'opacity-35'
              )}
            >
              <PlusIcon className="h-[19px] w-[19px] text-white" />
            </span>
          </button>
        </div>
      </nav>
      )}
    </>
  );
}
