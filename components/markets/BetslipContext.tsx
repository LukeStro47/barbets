'use client';

import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

/** What the drawer opens primed with: a side for yes_no/over_under, an option id for multiple_choice. */
export interface BetslipPick {
  side?: string;
  optionId?: string;
}

interface BetslipState {
  isOpen: boolean;
  pick: BetslipPick | null;
  /** Open the drawer primed with a pick (or with whatever was last selected, if omitted). */
  open: (pick?: BetslipPick) => void;
  close: () => void;
}

const BetslipCtx = createContext<BetslipState | null>(null);

/**
 * Lets anything on the market page open the bet drawer primed with a specific pick, without
 * that control having to live inside `BetslipBar`. The drawer is pinned to the viewport and the
 * things that open it (the option rows in "What you can back", the two sides in the slip, the
 * Bet pill) are scattered across the page and the fixed bar, so the alternative was hoisting
 * half the page into one client component. Provider holds only the selection; `BetslipBar` still
 * owns the stake, the submit, and every piece of market data.
 */
export function BetslipProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [pick, setPick] = useState<BetslipPick | null>(null);

  const open = useCallback((next?: BetslipPick) => {
    if (next) setPick(next);
    setIsOpen(true);
  }, []);
  const close = useCallback(() => setIsOpen(false), []);

  const value = useMemo(() => ({ isOpen, pick, open, close }), [isOpen, pick, open, close]);
  return <BetslipCtx.Provider value={value}>{children}</BetslipCtx.Provider>;
}

/**
 * Returns null outside a provider rather than throwing: the explainer cards render on market
 * states where there is no betslip at all (a closed market's line still needs displaying), and
 * a hard throw would make an unrelated screen crash for want of a drawer nobody can open.
 */
export function useBetslip(): BetslipState | null {
  return useContext(BetslipCtx);
}
