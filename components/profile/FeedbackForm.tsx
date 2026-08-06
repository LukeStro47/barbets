'use client';

import { useState, useTransition } from 'react';
import { submitFeedback, type FeedbackCategory } from '@/lib/actions/feedback';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/cn';

const CATEGORIES: { value: FeedbackCategory; label: string }[] = [
  { value: 'bug', label: '🐛 Bug' },
  { value: 'idea', label: '💡 Idea' },
  { value: 'general', label: '💬 General' },
];

export function FeedbackForm() {
  const [category, setCategory] = useState<FeedbackCategory>('general');
  const [message, setMessage] = useState('');
  const [wantsFollowup, setWantsFollowup] = useState(false);
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
      const result = await submitFeedback(message, category, wantsFollowup, pageUrl);
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

      <div className="space-y-1.5">
        <label className="block text-xs font-semibold uppercase tracking-wide text-espresso-500">What kind?</label>
        <div className="flex gap-2">
          {CATEGORIES.map((c) => (
            <button
              key={c.value}
              type="button"
              onClick={() => setCategory(c.value)}
              className={cn(
                'flex-1 rounded-full border px-3 py-1.5 text-sm font-semibold',
                category === c.value ? 'border-honey-500 bg-honey-50 text-honey-800' : 'border-espresso-200 text-espresso-600'
              )}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>

      <textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        maxLength={2000}
        rows={6}
        placeholder="Bug, idea, or anything else on your mind…"
        className="w-full rounded-xl border border-espresso-200 bg-paper-white px-4 py-2.5 text-espresso-900 placeholder:text-espresso-300 focus:border-honey-500 focus:outline-none focus:ring-2 focus:ring-honey-200"
      />

      <label className="flex items-center gap-2 text-sm text-espresso-600">
        <input
          type="checkbox"
          checked={wantsFollowup}
          onChange={(e) => setWantsFollowup(e.target.checked)}
          className="h-4 w-4 shrink-0 rounded border-espresso-300 text-honey-600 focus:ring-honey-400"
        />
        I'd like a follow-up
      </label>

      <Button type="button" disabled={isPending || !message.trim()} onClick={submit} className="w-full">
        {isPending ? 'Sending…' : 'Send feedback'}
      </Button>
    </div>
  );
}
