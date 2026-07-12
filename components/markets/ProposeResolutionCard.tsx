'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { proposeResolution } from '@/lib/actions/resolution';
import { Button } from '@/components/ui/Button';
import { OptionLabel } from '@/components/markets/OptionLabel';
import type { Market, MarketOption } from '@/lib/actions/markets';

const inputClasses =
  'w-full rounded-xl border border-espresso-200 bg-paper-white px-4 py-2.5 text-espresso-900 focus:border-honey-500 focus:outline-none focus:ring-2 focus:ring-honey-200';

/** Lives inside the resolution criteria card rather than off on its own — proposing is squarely part of "what is this market, and what happens to it next." Collapsed behind a button while still `open` (proposing early locks betting, so that shouldn't be one accidental tap away); always expanded once `closed`, since proposing is the only way forward at that point. */
export function ProposeResolutionCard({ groupId, market, options }: { groupId: string; market: Market; options: MarketOption[] | null }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const isMultipleChoice = market.market_type === 'multiple_choice';
  const [proposeOutcome, setProposeOutcome] = useState<string | null>(null);
  const [justification, setJustification] = useState('');
  const [expanded, setExpanded] = useState(market.status !== 'open');

  const sides = market.market_type === 'yes_no' ? (['yes', 'no'] as const) : (['over', 'under'] as const);
  const choiceLabels: { value: string; label: string }[] = isMultipleChoice
    ? [...(options ?? []).map((o) => ({ value: o.id, label: o.label })), { value: 'void', label: 'VOID' }]
    : [...sides.map((s) => ({ value: s, label: s.toUpperCase() })), { value: 'void', label: 'VOID' }];

  function proposalChoiceFor(value: string) {
    return isMultipleChoice && value !== 'void'
      ? ({ optionId: value } as const)
      : ({ outcome: value as 'yes' | 'no' | 'over' | 'under' | 'void' } as const);
  }

  function submit() {
    if (!proposeOutcome) return;
    setError(null);
    startTransition(async () => {
      const result = await proposeResolution(groupId, market.id, proposalChoiceFor(proposeOutcome), justification || undefined);
      if (result.error) {
        setError(result.error);
      } else {
        router.refresh();
      }
    });
  }

  if (!expanded) {
    return (
      <Button variant="outline" className="w-full" onClick={() => setExpanded(true)}>
        Already decided? Propose the outcome
      </Button>
    );
  }

  return (
    <div className="space-y-3 border-t border-espresso-100 pt-4">
      <p className="text-sm font-semibold text-espresso-700">Propose what happened</p>
      {market.status === 'open' && (
        <p className="text-xs font-semibold text-danger-700">Proposing now locks betting for everyone immediately.</p>
      )}
      {error && <p className="text-sm text-danger-700">{error}</p>}
      <div className="flex flex-wrap gap-2">
        {choiceLabels.map((c) => (
          <button
            key={c.value}
            type="button"
            onClick={() => setProposeOutcome(c.value)}
            className={`rounded-full border px-4 py-1.5 text-sm font-semibold uppercase ${
              proposeOutcome === c.value ? 'border-honey-500 bg-honey-50 text-honey-800' : 'border-espresso-200 text-espresso-600'
            }`}
          >
            <OptionLabel label={c.label} />
          </button>
        ))}
      </div>
      <textarea
        value={justification}
        onChange={(e) => setJustification(e.target.value)}
        placeholder="Short justification (optional, but helps everyone trust the call)"
        rows={2}
        className={inputClasses}
      />
      <Button disabled={isPending || !proposeOutcome} onClick={submit} className="w-full">
        Submit proposal
      </Button>
    </div>
  );
}
