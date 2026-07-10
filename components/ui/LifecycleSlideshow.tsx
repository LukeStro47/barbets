'use client';

import { useState } from 'react';
import { Card } from '@/components/ui/Card';

export interface LifecycleStep {
  icon: string;
  label: string;
  body: string;
}

/** Click-through, one-step-at-a-time viewer for a short ordered sequence (the market lifecycle on the how-it-works page) — a horizontal-scroll row of cards reads as clutter at this length, one card with prev/next reads as a story. */
export function LifecycleSlideshow({ steps }: { steps: LifecycleStep[] }) {
  const [index, setIndex] = useState(0);
  const step = steps[index];
  const isFirst = index === 0;
  const isLast = index === steps.length - 1;

  return (
    <div className="space-y-3">
      <Card className="flex min-h-40 flex-col items-center justify-center gap-2 p-6 text-center">
        <span className="text-3xl leading-none">{step.icon}</span>
        <span className="font-display font-bold text-espresso-800">{step.label}</span>
        <span className="text-sm leading-snug text-espresso-500">{step.body}</span>
      </Card>

      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => setIndex((i) => i - 1)}
          disabled={isFirst}
          aria-label="Previous step"
          className="flex h-9 w-9 items-center justify-center rounded-full border border-espresso-200 text-espresso-700 transition-colors hover:bg-espresso-50 disabled:opacity-30"
        >
          ←
        </button>

        <div className="flex gap-1.5">
          {steps.map((s, i) => (
            <button
              key={s.label}
              type="button"
              onClick={() => setIndex(i)}
              aria-label={`Go to ${s.label}`}
              className={`h-1.5 w-1.5 rounded-full transition-colors ${i === index ? 'bg-honey-500' : 'bg-espresso-200'}`}
            />
          ))}
        </div>

        <button
          type="button"
          onClick={() => setIndex((i) => i + 1)}
          disabled={isLast}
          aria-label="Next step"
          className="flex h-9 w-9 items-center justify-center rounded-full border border-espresso-200 text-espresso-700 transition-colors hover:bg-espresso-50 disabled:opacity-30"
        >
          →
        </button>
      </div>
    </div>
  );
}
