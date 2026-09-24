'use client';

import { GroupAvatar } from '@/components/ui/GroupAvatar';
import { OPEN_GROUP_SWITCHER_EVENT } from '@/components/layout/BottomNav';

function SwitcherGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M4 6l4-3 4 3M4 10l4 3 4-3" />
    </svg>
  );
}

function HomeGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M2.5 7.2 8 2.8l5.5 4.4v6.1h-11z" />
    </svg>
  );
}

/**
 * The persistent in-group identity bar (design 4g/4c) — replaces the old GroupHeader link to
 * Settings. Tapping anywhere on the bar (name or the right-hand button) opens the same switcher
 * sheet BottomNav already owns, via OPEN_GROUP_SWITCHER_EVENT, rather than duplicating the
 * sheet's state/group-list here. No date, no season detail, no logo — per 4g's own spec, that
 * detail lives on the leaderboard, market rows, and the switcher sheet itself, not this bar.
 *
 * Settings is reached from the "Group" bottom-nav tab (the leaderboard page) now that this bar
 * no longer links there directly — see that page for the entry point.
 */
export function GroupBar({
  groupName,
  avatarKey,
  hasOtherGroups,
  needsYou,
}: {
  groupName: string;
  avatarKey: string | null;
  /** False once the user has only one group — the button becomes a plain home glyph with
   * nothing to switch to, per 4g's third state. */
  hasOtherGroups: boolean;
  /** True when some group other than this one has something waiting on the viewer. */
  needsYou: boolean;
}) {
  const openSwitcher = () => window.dispatchEvent(new CustomEvent(OPEN_GROUP_SWITCHER_EVENT));

  return (
    <button
      onClick={openSwitcher}
      aria-label={hasOtherGroups ? `Switch groups, currently ${groupName}` : groupName}
      className="flex w-full items-center gap-[11px] rounded-[14px] border-0 bg-transparent p-0 text-left"
    >
      <GroupAvatar name={groupName} avatarKey={avatarKey} className="h-[30px] w-[30px] text-[10.5px]" fallbackClassName="bg-ink text-on-ink" />
      <span className="min-w-0 flex-1 truncate text-[16px] font-extrabold tracking-[-0.015em] text-ink">{groupName}</span>
      <span className="relative flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[11px] border border-hairline bg-rule text-ink">
        {hasOtherGroups ? <SwitcherGlyph className="h-[15px] w-[15px]" /> : <HomeGlyph className="h-[15px] w-[15px]" />}
        {hasOtherGroups && needsYou && <span className="absolute top-[-2px] right-[-2px] h-[9px] w-[9px] rounded-full border-2 border-surface bg-alert" />}
      </span>
    </button>
  );
}
