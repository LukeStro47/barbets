'use client';

import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import type { ReactNode, RefObject } from 'react';

/** What the inline bet card is primed with: a side for yes_no/over_under, an option id for
 * multiple_choice. An **empty object** is meaningful and distinct from omitting the argument: it
 * says "clear to nothing chosen," which is what "Pick a side" on the line ticket wants. */
export interface BetslipPick {
  side?: string;
  optionId?: string;
}

interface BetslipState {
  pick: BetslipPick | null;
  /** Set a pick and scroll the inline "Your bet" card into view — the design's own bet screens
   * (4d/4h) put the bet form directly on the page rather than behind a drawer, so "open" now
   * means "bring it into view already primed," not "reveal a hidden sheet." */
  open: (pick?: BetslipPick) => void;
  /** The DOM node BetslipBar's inline card registers itself under, so `open()` has something to
   * scroll to. A ref object rather than a callback ref: BetslipBar needs to both read and set it. */
  slipRef: RefObject<HTMLDivElement | null>;
}

const BetslipCtx = createContext<BetslipState | null>(null);

/**
 * Lets anything on the market page prime the inline bet card with a specific pick and scroll it
 * into view, without that control having to live inside `BetslipBar` itself — currently just the
 * sticky footer's amount pill (no pick, a plain scroll-back), but kept generic since a future
 * caller elsewhere on the page (an odds row, a card summarizing "what you can back") is a real
 * candidate to prime a specific side/option the same way the pre-Ledger explainer cards used to,
 * before the bet form itself moved inline and made a separate "browse your options" card
 * redundant. Provider holds only the selection and a scroll target; `BetslipBar` still owns the
 * stake, the submit, and every piece of market data.
 */
export function BetslipProvider({ children }: { children: ReactNode }) {
  const [pick, setPick] = useState<BetslipPick | null>(null);
  const slipRef = useRef<HTMLDivElement | null>(null);

  const open = useCallback((next?: BetslipPick) => {
    if (next) setPick(next);
    slipRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, []);

  const value = useMemo(() => ({ pick, open, slipRef }), [pick, open]);
  return <BetslipCtx.Provider value={value}>{children}</BetslipCtx.Provider>;
}

/**
 * Returns null outside a provider rather than throwing: the explainer cards render on market
 * states where there is no bet slip at all (a closed market's line still needs displaying), and
 * a hard throw would make an unrelated screen crash for want of a bet card nobody can open.
 */
export function useBetslip(): BetslipState | null {
  return useContext(BetslipCtx);
}
