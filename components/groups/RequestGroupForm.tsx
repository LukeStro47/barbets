'use client';

import { useState, useTransition } from 'react';
import { submitFeedback } from '@/lib/actions/feedback';
import { Button } from '@/components/ui/Button';

/** Request-a-new-public-group, built directly into the directory rather than buried as a pill in
    the general feedback form — this is where someone actually looking for their school would be.
    Reuses the same feedback pipeline (durable row + Slack card) via the group_request category;
    the moderator checkbox has no schema field of its own, so it folds into the message text and
    doubles as "wants a follow-up" (staff would have to reach out either way to actually assign
    them). */
export function RequestGroupForm() {
  const [name, setName] = useState('');
  const [wantsToModerate, setWantsToModerate] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [isPending, startTransition] = useTransition();

  if (sent) {
    return <p className="text-sm font-semibold text-success-700">Thanks, we&apos;ll follow-up soon</p>;
  }

  function submit() {
    setError(null);
    startTransition(async () => {
      const pageUrl = typeof document !== 'undefined' ? document.location.pathname : null;
      const message = `Requesting a group: ${name.trim()}${wantsToModerate ? '. Would like to be considered as a moderator for it.' : ''}`;
      const result = await submitFeedback(message, 'group_request', wantsToModerate, pageUrl);
      if (result.error) {
        setError(result.error);
      } else {
        setSent(true);
      }
    });
  }

  return (
    <div className="space-y-2.5 rounded-[18px] border border-espresso-100 bg-paper-white p-4">
      <div>
        <p className="text-[13px] font-extrabold text-espresso-800">Want to see another school or topic?</p>
        <p className="mt-0.5 text-[11.5px] text-espresso-400">Tell us what it is, and we&apos;ll consider it</p>
      </div>
      {error && <p className="text-sm text-danger-700">{error}</p>}
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        maxLength={120}
        placeholder="e.g. Penn State"
        className="w-full rounded-[10px] border border-espresso-200 bg-paper px-3.5 py-2.5 text-[14px] font-semibold text-espresso-950 placeholder:text-espresso-300 focus:border-honey-500 focus:outline-none focus:ring-2 focus:ring-honey-200"
      />
      <label className="flex items-center gap-2 text-[13px] text-espresso-600">
        <input
          type="checkbox"
          checked={wantsToModerate}
          onChange={(e) => setWantsToModerate(e.target.checked)}
          className="h-4 w-4 shrink-0 rounded border-espresso-300 text-honey-600 focus:ring-honey-400"
        />
        I&apos;d like to be considered as a moderator
      </label>
      <Button type="button" disabled={isPending || !name.trim()} onClick={submit} className="w-full">
        {isPending ? 'Sending…' : 'Request this group'}
      </Button>
    </div>
  );
}
