'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { getActiveNavTab, getRouteGroupId, shouldHideBottomNav, type NavTab } from '@/lib/navRoute';
import { formatTokenInputValue } from '@/lib/formatNumber';
import { GROUP_NAME_MAX_LENGTH, TOKEN_ALLOCATION_MAX } from '@/lib/limits';
import { useKeyboardState } from '@/lib/useKeyboardInset';
import { cn } from '@/lib/cn';
import { GroupAvatar } from '@/components/ui/GroupAvatar';
import { BrandTile } from '@/components/ui/BrandMark';
import { RowChevron } from '@/components/ui/Screen';
import { NEW_GROUP_EVENT } from '@/components/groups/StartGroupButton';
import type { MarketType } from '@/lib/marketType';

export type NavGroup = {
  id: string;
  name: string;
  avatarKey: string | null;
  /** "2,450 · 2nd of 8" — the viewer's balance and standing in this group (4c). */
  meta: string;
  needsYou?: boolean;
  /** How many things in this group are waiting on the viewer, for 4c's alert pill. */
  needsCount?: number;
};

/** Dispatched by GroupBar (the persistent in-group header) to open the switcher sheet BottomNav
 * owns, rather than each in-group page carrying its own copy of the sheet's state and group list. */
export const OPEN_GROUP_SWITCHER_EVENT = 'barbets:open-group-switcher';

/** Why the "+" create-market button is blocked for a group, if it is — distinct reasons because
 * they need distinct copy. */
export interface GroupBettingStatus {
  blocked: boolean;
  reason?: 'owner_off' | 'season_intermission' | 'season_winding_down' | 'not_moderator';
  ownerNickname?: string;
  seasonName?: string;
}

const TAB_LABEL: Record<NavTab, string> = { home: 'Home', markets: 'Markets', inbox: 'Inbox', group: 'Group', you: 'You' };

type GlyphProps = { className?: string; strokeWidth: number };
const glyph =
  (d: string | string[]) =>
  ({ className, strokeWidth }: GlyphProps) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" className={className}>
      {(Array.isArray(d) ? d : [d]).map((p) => (
        <path key={p} d={p} />
      ))}
    </svg>
  );

// Paths are the artboards' own (4a in-group bar, 4q out-of-group bar — the two use different
// house/person drawings, so each keeps its own).
const TAB_GLYPH: Record<NavTab, (props: GlyphProps) => React.ReactNode> = {
  home: glyph('M3.5 10.5 12 4l8.5 6.5V20H3.5z'),
  markets: glyph('M3 17l5-5 3 3 6-7M14 8h5v5'),
  inbox: glyph(['M12 4a5 5 0 0 0-5 5v4l-2 3h14l-2-3V9a5 5 0 0 0-5-5z', 'M10 19a2 2 0 0 0 4 0']),
  group: glyph('M8 20V11M14 20V4M20 20v-7M2 20h20'),
  you: glyph('M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8c0-3.9 3.1-7 7-7s7 3.1 7 7'),
};
const OUT_OF_GROUP_YOU = glyph(['M4 19c1.4-3.6 4.2-5.4 8-5.4s6.6 1.8 8 5.4', 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8']);

/** 4p's three question types, in the design's order, with its own names and one-liners. */
const CREATE_TYPES: { type: MarketType; title: string; sub: string; icon: React.ReactNode }[] = [
  {
    type: 'yes_no',
    title: 'Yes or no',
    sub: "Will it happen, or won't it",
    icon: <path d="M5 8h6M5 16h6M15 6l3 3 3-6" />,
  },
  {
    type: 'multiple_choice',
    title: 'Pick a winner',
    sub: 'Two or more named options',
    icon: (
      <>
        <circle cx="6" cy="7" r="2" />
        <circle cx="6" cy="17" r="2" />
        <path d="M11 7h8M11 17h8" />
      </>
    ),
  },
  {
    type: 'over_under',
    title: 'A number',
    sub: 'How many, how long, how much',
    icon: <path d="M4 18h16M7 18V9M12 18V5M17 18v-6" />,
  },
];

function NavItem({
  tab,
  active,
  onClick,
  dot,
  width = 56,
  Glyph,
}: {
  tab: NavTab;
  active: boolean;
  onClick: () => void;
  dot?: boolean;
  width?: number;
  Glyph?: (props: GlyphProps) => React.ReactNode;
}) {
  const G = Glyph ?? TAB_GLYPH[tab];
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className="flex flex-col items-center gap-1 border-0 bg-transparent p-0"
      style={{ width }}
    >
      <span className={cn('relative flex', active ? 'text-signal' : 'text-faint')}>
        <G strokeWidth={active ? 2.2 : 1.9} className="h-[21px] w-[21px]" />
        {dot && <span className="absolute top-[-1px] right-[-3px] h-2 w-2 rounded-full border-2 border-surface bg-alert" />}
      </span>
      <span className={cn('text-[10px]', active ? 'font-bold text-signal' : 'font-semibold text-faint')}>{TAB_LABEL[tab]}</span>
    </button>
  );
}

/**
 * App-wide bottom navigation (4a in-group: Markets · Inbox · + · Group · You; 4q out-of-group:
 * Home · Inbox · You). Fixed to the viewport and mounted as a sibling of PullToRefresh/
 * PageTransition (see app/(app)/layout.tsx) — nesting it under a transformed ancestor would break
 * position:fixed.
 *
 * Also owns the two sheets reachable from anywhere: the group switcher (4c, opened by GroupBar via
 * OPEN_GROUP_SWITCHER_EVENT) and the "Start something" create sheet (4p). Those keep rendering on
 * drill-in screens where the bar itself is hidden (lib/navRoute.ts).
 */
export function BottomNav({
  groups,
  bettingStatusByGroup,
  hasNeedsYou = false,
}: {
  groups: NavGroup[];
  bettingStatusByGroup: Record<string, GroupBettingStatus>;
  hasNeedsYou?: boolean;
}) {
  const pathname = usePathname();
  const router = useRouter();

  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [newGroupOpen, setNewGroupOpen] = useState(false);
  const [bettingOffOpen, setBettingOffOpen] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [groupSeedAmount, setGroupSeedAmount] = useState('1,000');

  // position:fixed uses the layout viewport, which doesn't shrink for the on-screen keyboard, so
  // the bar would float on top of it. There's nothing to switch tabs on mid-type anyway.
  const { visible: keyboardOpen, inset: keyboardInset } = useKeyboardState();

  useEffect(() => {
    if (!switcherOpen && !createOpen && !newGroupOpen) return;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, [switcherOpen, createOpen, newGroupOpen]);

  // The hub's "New group" button, 5h's "Start a group", and 4c's own button all open the same
  // name-and-allocation sheet, so a group is always named in one place before the wizard (5l).
  useEffect(() => {
    const onNewGroup = () => {
      setSwitcherOpen(false);
      setCreateOpen(false);
      setNewGroupOpen(true);
    };
    window.addEventListener(NEW_GROUP_EVENT, onNewGroup);
    return () => window.removeEventListener(NEW_GROUP_EVENT, onNewGroup);
  }, []);

  useEffect(() => {
    const onOpenSwitcher = () => {
      setCreateOpen(false);
      setSwitcherOpen(true);
    };
    window.addEventListener(OPEN_GROUP_SWITCHER_EVENT, onOpenSwitcher);
    return () => window.removeEventListener(OPEN_GROUP_SWITCHER_EVENT, onOpenSwitcher);
  }, []);

  // The demo's post-tour CTA lands here with ?startGroup=1 (it lives outside this layout, so it
  // can't dispatch NEW_GROUP_EVENT). Opened once, then the flag is stripped.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('startGroup') !== '1') return;
    setNewGroupOpen(true);
    params.delete('startGroup');
    const newSearch = params.toString();
    router.replace(`${window.location.pathname}${newSearch ? `?${newSearch}` : ''}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const prevPathnameRef = useRef(pathname);
  if (pathname !== prevPathnameRef.current) {
    prevPathnameRef.current = pathname;
    if (switcherOpen) setSwitcherOpen(false);
    if (createOpen) setCreateOpen(false);
    if (newGroupOpen) setNewGroupOpen(false);
  }

  const activeTab = getActiveNavTab(pathname);
  const groupId = getRouteGroupId(pathname);

  // Profile isn't under /groups/[id], but arriving there from a group should still feel like
  // you're in that group. The all-groups hub is the one deliberate "not in a group" signal.
  const lastGroupIdRef = useRef<string | null>(null);
  if (groupId) {
    lastGroupIdRef.current = groupId;
  } else if (pathname === '/groups') {
    lastGroupIdRef.current = null;
  }
  const effectiveGroupId = groupId ?? (pathname === '/profile' || pathname === '/inbox' ? lastGroupIdRef.current : null);
  const currentGroup = effectiveGroupId ? groups.find((g) => g.id === effectiveGroupId) : undefined;
  const inGroup = !!currentGroup;
  const hideBar = shouldHideBottomNav(pathname);

  const bettingStatus = currentGroup ? bettingStatusByGroup[currentGroup.id] : undefined;

  const openCreate = () => {
    setSwitcherOpen(false);
    setCreateOpen(true);
  };

  function goToTab(tab: NavTab) {
    if (tab === 'home') router.push('/groups');
    else if (tab === 'inbox') router.push(currentGroup ? `/inbox?group=${currentGroup.id}` : '/inbox');
    else if (tab === 'you') router.push(currentGroup ? `/profile?group=${currentGroup.id}` : '/profile');
    else if (tab === 'markets') router.push(currentGroup ? `/groups/${currentGroup.id}` : '/groups?all=1');
    else if (tab === 'group') router.push(currentGroup ? `/groups/${currentGroup.id}/leaderboard` : '/groups?all=1');
  }

  function pickType(type: MarketType) {
    if (!currentGroup) return;
    // Fail fast: no point starting the form only to be told betting's off on submit.
    if (bettingStatus?.blocked) {
      setCreateOpen(false);
      setBettingOffOpen(true);
      return;
    }
    setCreateOpen(false);
    router.push(`/groups/${currentGroup.id}/markets/new?type=${type}`);
  }

  function browseTemplates() {
    if (!currentGroup) return;
    if (bettingStatus?.blocked) {
      setCreateOpen(false);
      setBettingOffOpen(true);
      return;
    }
    setCreateOpen(false);
    router.push(`/groups/${currentGroup.id}/markets/templates`);
  }

  function continueCreateGroup() {
    const name = groupName.trim();
    if (!name) return;
    setNewGroupOpen(false);
    const params = new URLSearchParams({ name, seedAmount: groupSeedAmount.replace(/,/g, '') || '1000' });
    router.push(`/groups/new?${params.toString()}`);
  }

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

      {/* ---- 4c: the group bar drops open into the switcher ---- */}
      {switcherOpen && (
        <>
          <div onClick={() => setSwitcherOpen(false)} className="fixed inset-0 z-50 animate-bottomnav-scrim-in bg-[rgba(12,16,24,0.34)]" />
          <div className="fixed inset-x-0 top-0 z-50 rounded-b-[22px] border-b border-hairline bg-surface pt-[calc(env(safe-area-inset-top)+12px)] shadow-[0_20px_40px_-18px_rgba(12,16,24,0.35)]">
            <div className="mx-auto max-w-[430px]">
              <div className="flex items-center gap-[11px] px-3.5 pb-[11px]">
                {currentGroup ? (
                  <>
                    <GroupAvatar name={currentGroup.name} avatarKey={currentGroup.avatarKey} className="h-[30px] w-[30px] text-[10.5px]" fallbackClassName="bg-ink text-on-ink" />
                    <span className="min-w-0 flex-1 truncate text-[16px] font-extrabold tracking-[-0.015em] text-ink">{currentGroup.name}</span>
                  </>
                ) : (
                  <span className="min-w-0 flex-1 text-[16px] font-extrabold tracking-[-0.015em] text-ink">Your groups</span>
                )}
                <button
                  type="button"
                  aria-label="Close"
                  onClick={() => setSwitcherOpen(false)}
                  className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[11px] border-0 bg-ink text-surface"
                >
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round">
                    <path d="M4 4l8 8M12 4l-8 8" />
                  </svg>
                </button>
              </div>

              <div className="max-h-[70dvh] overflow-y-auto px-2.5 pt-1 pb-3.5">
                <p className="mb-1.5 px-1.5 text-[10.5px] font-bold tracking-[0.1em] text-faint uppercase">Your groups</p>
                {groups.map((g) => {
                  const current = g.id === currentGroup?.id;
                  return (
                    <button
                      key={g.id}
                      type="button"
                      onClick={() => {
                        setSwitcherOpen(false);
                        router.push(`/groups/${g.id}`);
                      }}
                      className={cn(
                        'flex w-full items-center gap-[11px] rounded-[14px] border-0 px-1.5 py-[9px] text-left',
                        current ? 'bg-signal-wash shadow-[inset_3px_0_0_var(--color-signal)]' : 'bg-transparent'
                      )}
                    >
                      <GroupAvatar name={g.name} avatarKey={g.avatarKey} className="h-9 w-9 text-[12px]" fallbackClassName="bg-ink text-on-ink" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[14.5px] font-bold text-ink">{g.name}</span>
                        <span className="mt-px block truncate font-mono text-[11.5px] text-faint">{g.meta}</span>
                      </span>
                      {current ? (
                        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-signal">
                          <path d="M2.5 8.5 6 12l7.5-8" />
                        </svg>
                      ) : g.needsYou ? (
                        <span className="inline-flex shrink-0 items-center gap-[5px] rounded-lg border border-alert-line bg-alert-bg px-2 py-1 text-[11px] font-bold text-alert">
                          <span className="h-1.5 w-1.5 rounded-full bg-alert" />
                          {g.needsCount ?? 1}
                        </span>
                      ) : null}
                    </button>
                  );
                })}
                {groups.length === 0 && <p className="px-1.5 py-2 text-sm text-faint">No groups yet.</p>}

                <div className="mt-2 flex gap-2 border-t border-rule pt-2.5">
                  <button
                    type="button"
                    onClick={() => {
                      setSwitcherOpen(false);
                      setNewGroupOpen(true);
                    }}
                    className="flex flex-1 items-center justify-center gap-[7px] rounded-xl border-0 bg-ink py-3 text-[13px] font-bold text-surface"
                  >
                    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                      <path d="M8 3v10M3 8h10" />
                    </svg>
                    New group
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setSwitcherOpen(false);
                      router.push('/join');
                    }}
                    className="flex flex-1 items-center justify-center rounded-xl border border-hairline bg-surface py-3 text-[13px] font-bold text-ink"
                  >
                    Join with code
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setSwitcherOpen(false);
                    router.push('/profile');
                  }}
                  className="mt-3 flex w-full items-center gap-[9px] border-0 border-t border-rule bg-transparent px-0 pt-[11px] text-left"
                >
                  <BrandTile size={19} />
                  <span className="text-[13px] font-extrabold tracking-[-0.03em] text-ink">barbets</span>
                  <span className="ml-auto text-[12px] font-semibold text-muted">Settings</span>
                  <RowChevron className="text-faint" />
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* ---- 4p: the + menu ---- */}
      {createOpen && currentGroup && (
        <>
          <div onClick={() => setCreateOpen(false)} className="fixed inset-0 z-50 animate-bottomnav-scrim-in bg-[rgba(12,16,24,0.4)]" />
          <div className="fixed inset-x-0 bottom-0 z-50 animate-bottomnav-sheet-up rounded-t-[26px] bg-surface px-[18px] pt-5 pb-[max(26px,env(safe-area-inset-bottom))] shadow-[0_-20px_40px_-18px_rgba(12,16,24,0.4)]">
            <div className="mx-auto max-w-[430px]">
              <div className="flex items-center justify-between gap-3">
                <span className="min-w-0">
                  <h2 className="text-[19px] font-extrabold tracking-[-0.02em] text-ink">Start something</h2>
                  <p className="mt-[3px] truncate text-[12.5px] text-faint">In {currentGroup.name}</p>
                </span>
                <button
                  type="button"
                  aria-label="Close"
                  onClick={() => setCreateOpen(false)}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[11px] border border-hairline bg-tile text-ink"
                >
                  <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round">
                    <path d="M4 4l8 8M12 4l-8 8" />
                  </svg>
                </button>
              </div>

              <p className="mt-[18px] text-[10.5px] font-bold tracking-[0.1em] text-faint uppercase">A market</p>
              <div className="mt-[9px] flex flex-col gap-2">
                {CREATE_TYPES.map((t) => (
                  <button
                    key={t.type}
                    type="button"
                    onClick={() => pickType(t.type)}
                    className="flex w-full items-center gap-[13px] rounded-2xl border border-hairline bg-surface px-[15px] py-[13px] text-left"
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-signal-tint text-signal">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                        {t.icon}
                      </svg>
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[14.5px] font-bold text-ink">{t.title}</span>
                      <span className="mt-px block text-[12px] text-faint">{t.sub}</span>
                    </span>
                    <RowChevron className="text-faint" />
                  </button>
                ))}
              </div>

              <p className="mt-[18px] text-[10.5px] font-bold tracking-[0.1em] text-faint uppercase">Or</p>
              <button
                type="button"
                onClick={browseTemplates}
                className="mt-[9px] flex w-full items-center gap-[13px] rounded-2xl border-0 bg-ink px-[15px] py-[13px] text-left"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/12 text-surface">
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
                    <rect x="4" y="4" width="7" height="7" rx="1.6" />
                    <rect x="13" y="4" width="7" height="7" rx="1.6" />
                    <rect x="4" y="13" width="7" height="7" rx="1.6" />
                    <rect x="13" y="13" width="7" height="7" rx="1.6" />
                  </svg>
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[14.5px] font-bold text-surface">Browse templates</span>
                  <span className="mt-px block text-[12px] text-surface/60">Start from an idea instead</span>
                </span>
                <RowChevron className="text-surface/60" />
              </button>

              <button
                type="button"
                onClick={() => {
                  setCreateOpen(false);
                  setNewGroupOpen(true);
                }}
                className="mt-3.5 flex w-full items-center gap-[13px] border-0 border-t border-rule bg-transparent px-0 pt-[13px] text-left"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-tile text-muted">
                  <svg width="17" height="17" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <path d="M8 3v10M3 8h10" />
                  </svg>
                </span>
                <span className="min-w-0 flex-1 text-[14px] font-bold text-ink">New group</span>
                <RowChevron className="text-faint" />
              </button>
            </div>
          </div>
        </>
      )}

      {/* ---- New group: name and allocation, then on to the wizard (5l) ---- */}
      {newGroupOpen && (
        <>
          <div onClick={() => setNewGroupOpen(false)} className="fixed inset-0 z-50 animate-bottomnav-scrim-in bg-[rgba(12,16,24,0.4)]" />
          <div
            className="fixed inset-x-0 bottom-0 z-50 animate-bottomnav-sheet-up rounded-t-[26px] bg-surface px-[18px] pt-5 pb-[max(26px,env(safe-area-inset-bottom))] shadow-[0_-20px_40px_-18px_rgba(12,16,24,0.4)]"
            style={{
              paddingBottom: keyboardOpen && keyboardInset > 0 ? `calc(env(safe-area-inset-bottom) + ${keyboardInset + 16}px)` : undefined,
            }}
          >
            <div className="mx-auto max-w-[430px]">
              <div className="flex items-center justify-between gap-3">
                <span className="min-w-0">
                  <h2 className="text-[19px] font-extrabold tracking-[-0.02em] text-ink">New group</h2>
                  <p className="mt-[3px] text-[12.5px] text-faint">A private table, everyone starts even.</p>
                </span>
                <button
                  type="button"
                  aria-label="Close"
                  onClick={() => setNewGroupOpen(false)}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[11px] border border-hairline bg-tile text-ink"
                >
                  <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round">
                    <path d="M4 4l8 8M12 4l-8 8" />
                  </svg>
                </button>
              </div>
              <p className="mt-[18px] text-[10.5px] font-bold tracking-[0.1em] text-faint uppercase">Group name</p>
              <input
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
                placeholder="Sunday League"
                maxLength={GROUP_NAME_MAX_LENGTH}
                className="mt-2 block h-14 w-full rounded-2xl border border-hairline bg-surface px-[15px] text-[16px] font-semibold text-ink placeholder:text-disabled-ink focus:border-[1.5px] focus:border-signal focus:shadow-[0_0_0_4px_rgba(45,85,245,0.08)] focus:outline-none"
              />
              <p className="mt-4 text-[10.5px] font-bold tracking-[0.1em] text-faint uppercase">Tokens each</p>
              <input
                type="text"
                inputMode="numeric"
                value={groupSeedAmount}
                onChange={(e) => setGroupSeedAmount(formatTokenInputValue(e.target.value, TOKEN_ALLOCATION_MAX))}
                className="mt-2 block h-14 w-full rounded-2xl border border-hairline bg-surface px-[15px] font-mono text-[16px] font-semibold text-ink focus:border-[1.5px] focus:border-signal focus:shadow-[0_0_0_4px_rgba(45,85,245,0.08)] focus:outline-none"
              />
              <button
                type="button"
                onClick={continueCreateGroup}
                disabled={!groupName.trim()}
                className="mt-5 w-full rounded-[14px] border-0 bg-ink py-[15px] text-[15px] font-bold text-surface disabled:bg-disabled-bg disabled:text-disabled-ink"
              >
                Next
              </button>
            </div>
          </div>
        </>
      )}

      {/* ---- The bar ---- */}
      {!hideBar && !keyboardOpen && (
        <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-hairline bg-surface/[0.94] px-[18px] pt-2.5 pb-[max(26px,env(safe-area-inset-bottom))] backdrop-blur-[8px]">
          <div className={cn('mx-auto flex max-w-[430px] items-center', inGroup ? 'justify-between' : 'justify-around')}>
            {inGroup ? (
              <>
                <NavItem tab="markets" active={activeTab === 'markets'} onClick={() => goToTab('markets')} />
                <NavItem tab="inbox" active={activeTab === 'inbox'} onClick={() => goToTab('inbox')} dot={hasNeedsYou} />
                <button
                  type="button"
                  onClick={openCreate}
                  aria-label="Start something"
                  aria-expanded={createOpen}
                  className={cn(
                    'flex h-12 w-12 items-center justify-center rounded-2xl border-0 bg-signal text-surface shadow-[0_10px_20px_-8px_rgba(45,85,245,0.6)]',
                    bettingStatus?.blocked && 'opacity-40'
                  )}
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                    <line x1="12" y1="5" x2="12" y2="19" />
                    <line x1="5" y1="12" x2="19" y2="12" />
                  </svg>
                </button>
                <NavItem tab="group" active={activeTab === 'group'} onClick={() => goToTab('group')} />
                <NavItem tab="you" active={activeTab === 'you'} onClick={() => goToTab('you')} />
              </>
            ) : (
              <>
                <NavItem tab="home" width={66} active={activeTab === 'home'} onClick={() => goToTab('home')} />
                <NavItem tab="inbox" width={66} active={activeTab === 'inbox'} onClick={() => goToTab('inbox')} dot={hasNeedsYou} />
                <NavItem tab="you" width={66} active={activeTab === 'you'} onClick={() => goToTab('you')} Glyph={OUT_OF_GROUP_YOU} />
              </>
            )}
          </div>
        </nav>
      )}
    </>
  );
}
