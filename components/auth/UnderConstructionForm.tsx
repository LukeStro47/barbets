'use client';

import { useActionState } from 'react';
import { checkBetaCode } from '@/lib/actions/betaGate';
import { Button } from '@/components/ui/Button';

const inputClasses =
  'w-full rounded-xl border border-hairline bg-surface px-4 py-2.5 text-ink placeholder:text-faint focus:border-signal focus:outline-none focus:ring-2 focus:ring-signal/15';

export function UnderConstructionForm({ next }: { next?: string }) {
  const [state, formAction, isPending] = useActionState(checkBetaCode, null);
  return (
    <form action={formAction} className="space-y-3">
      {state?.error && <p className="text-sm text-alert">{state.error}</p>}
      {next && <input type="hidden" name="next" value={next} />}
      <input name="code" placeholder="Access code" required className={inputClasses} />
      <Button type="submit" disabled={isPending} className="w-full">
        Enter
      </Button>
    </form>
  );
}
