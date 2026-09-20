'use client';

import { useState, useTransition } from 'react';
import { submitFeedback, type FeedbackCategory } from '@/lib/actions/feedback';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/cn';

// group_request is deliberately not offered here — its dedicated /groups/discover form was
// removed, and it wasn't reintroduced as a pill.
const CATEGORIES: { value: FeedbackCategory; label: string }[] = [
  { value: 'bug', label: 'Bug' },
  { value: 'idea', label: 'Idea' },
  { value: 'general', label: 'General' },
];

const PLACEHOLDER: Record<FeedbackCategory, string> = {
  bug: 'Bug, idea, or anything else on your mind…',
  idea: 'Bug, idea, or anything else on your mind…',
  general: 'Bug, idea, or anything else on your mind…',
  group_request: '',
};

export function FeedbackForm() {
  const [category, setCategory] = useState<FeedbackCategory>('general');
  const [message, setMessage] = useState('');
  const [wantsFollowup, setWantsFollowup] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [isPending, startTransition] = useTransition();

  if (sent) {
    return <p className="text-sm font-semibold text-gain">Thanks, we&apos;ll follow-up soon</p>;
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
      {error && <p className="text-sm text-alert">{error}</p>}

      <div className="space-y-1.5">
        <label className="block text-xs font-semibold uppercase tracking-wide text-muted">What kind?</label>
        <div className="flex gap-2">
          {CATEGORIES.map((c) => (
            <button
              key={c.value}
              type="button"
              onClick={() => setCategory(c.value)}
              className={cn(
                'flex-1 rounded-full border px-3 py-1.5 text-sm font-semibold',
                category === c.value ? 'border-signal bg-signal-tint text-signal-deep' : 'border-hairline text-muted'
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
        placeholder={PLACEHOLDER[category]}
        className="w-full rounded-xl border border-hairline bg-surface px-4 py-2.5 text-ink placeholder:text-faint focus:border-signal focus:outline-none focus:ring-2 focus:ring-signal/15"
      />

      <label className="flex items-center gap-2 text-sm text-muted">
        <input
          type="checkbox"
          checked={wantsFollowup}
          onChange={(e) => setWantsFollowup(e.target.checked)}
          className="h-4 w-4 shrink-0 rounded border-dash text-signal focus:ring-signal"
        />
        I'd like a follow-up
      </label>

      <Button type="button" disabled={isPending || !message.trim()} onClick={submit} className="w-full">
        {isPending ? 'Sending…' : 'Send feedback'}
      </Button>
    </div>
  );
}
