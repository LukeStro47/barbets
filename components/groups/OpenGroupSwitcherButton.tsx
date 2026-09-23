'use client';

/** Fired at `window` so BottomNav can open its group switcher from the Markets hub header
 * (and anywhere else that needs the same sheet) without owning BottomNav's state. */
export const OPEN_GROUP_SWITCHER_EVENT = 'barbets:open-group-switcher';

/** The dual-chevron tile in the Markets hub header. Red waiting-on-you dot matches DESIGN.md's
 * group-chip-off badge, without inventing a second notification surface. */
export function OpenGroupSwitcherButton({ waitingOnYou = false }: { waitingOnYou?: boolean }) {
  return (
    <button
      type="button"
      aria-label="Switch group"
      onClick={() => window.dispatchEvent(new CustomEvent(OPEN_GROUP_SWITCHER_EVENT))}
      className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px] border border-hairline bg-surface text-ink"
    >
      <svg width="14" height="16" viewBox="0 0 14 16" fill="none" aria-hidden>
        <path d="M3.5 5.5 7 2.5l3.5 3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M3.5 10.5 7 13.5l3.5-3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {waitingOnYou && (
        <span className="absolute -top-0.5 -right-0.5 h-[9px] w-[9px] rounded-full bg-alert ring-2 ring-canvas" aria-hidden />
      )}
    </button>
  );
}
