'use client';

import { useState, useTransition } from 'react';
import { submitFeedback } from '@/lib/actions/feedback';
import { Button } from '@/components/ui/Button';

export function FeedbackForm() {
  const [message, setMessage] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [isPending, startTransition] = useTransition();

  if (sent) {
    return <p className="text-sm font-semibold text-success-700">Thanks, sent.</p>;
  }

  function submit() {
    setError(null);
    startTransition(async () => {
      // Best-effort context for the team reading it in Slack — wherever the visit before this
      // page came from, if anywhere.
      const pageUrl = typeof document !== 'undefined' && document.referrer ? document.referrer : null;
      const result = await submitFeedback(message, pageUrl);
      if (result.error) {
        setError(result.error);
      } else {
        setSent(true);
      }
    });
  }

  return (
    <div className="space-y-3">
      {error && <p className="text-sm text-danger-700">{error}</p>}
      <textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        maxLength={2000}
        rows={6}
        placeholder="Bug, idea, or anything else on your mind…"
        className="w-full rounded-xl border border-espresso-200 bg-paper-white px-4 py-2.5 text-espresso-900 placeholder:text-espresso-300 focus:border-honey-500 focus:outline-none focus:ring-2 focus:ring-honey-200"
      />
      <Button type="button" disabled={isPending || !message.trim()} onClick={submit} className="w-full">
        {isPending ? 'Sending…' : 'Send feedback'}
      </Button>
    </div>
  );
}
