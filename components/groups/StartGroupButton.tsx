'use client';

/** Fired at `window` by any "start a group" affordance outside the bottom nav; BottomNav listens
 * and opens its name-and-allocation sheet. An event rather than a shared store or a `?new=1`
 * search param because there is exactly one listener, it owns state nothing else should set
 * directly, and the sheet is not a place worth linking to or restoring on back. */
export const NEW_GROUP_EVENT = 'barbets:new-group';

/**
 * Start a group, in the two shapes the mockups draw it: 4q's ink "New group" button beside
 * "Join with code", and 5h's dark row ("Start a group / Name it, invite the usual suspects").
 * Both open the same sheet, so a group is always named in one place before the wizard (5l).
 */
export function StartGroupButton({ variant = 'button' }: { variant?: 'button' | 'row' }) {
  const open = () => window.dispatchEvent(new CustomEvent(NEW_GROUP_EVENT));

  if (variant === 'row') {
    return (
      <button type="button" onClick={open} className="flex w-full items-center gap-3 rounded-[18px] border-0 bg-ink p-4 text-left">
        <span className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[11px] bg-white/10 text-surface">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[14.5px] font-bold text-surface">Start a group</span>
          <span className="mt-0.5 block text-[12px] text-faint">Name it, invite the usual suspects</span>
        </span>
        <svg width="7" height="12" viewBox="0 0 8 14" fill="none" className="shrink-0 text-muted">
          <path d="M1 1l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={open}
      className="flex h-12 flex-1 items-center justify-center gap-[7px] rounded-[14px] border-0 bg-ink text-[13.5px] font-bold text-surface"
    >
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
        <path d="M8 2.5v11M2.5 8h11" />
      </svg>
      New group
    </button>
  );
}
