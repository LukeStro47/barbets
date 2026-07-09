'use client';

import { useActionState } from 'react';
import { checkBetaCode } from '@/lib/actions/betaGate';
import { Button } from '@/components/ui/Button';

const inputClasses =
  'w-full rounded-xl border border-espresso-200 bg-paper-white px-4 py-2.5 text-espresso-900 placeholder:text-espresso-300 focus:border-honey-500 focus:outline-none focus:ring-2 focus:ring-honey-200';

export function UnderConstructionForm({ next }: { next?: string }) {
  const [state, formAction, isPending] = useActionState(checkBetaCode, null);
  return (
    <form action={formAction} className="space-y-3">
      {state?.error && <p className="text-sm text-danger-700">{state.error}</p>}
      {next && <input type="hidden" name="next" value={next} />}
      <input name="code" placeholder="Access code" required className={inputClasses} />
      <Button type="submit" disabled={isPending} className="w-full">
        Enter
      </Button>
    </form>
  );
}
