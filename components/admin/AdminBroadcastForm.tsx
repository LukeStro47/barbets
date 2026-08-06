'use client';

import { useState, useTransition } from 'react';
import { sendAdminBroadcast } from '@/lib/actions/admin';
import { Button } from '@/components/ui/Button';

const inputClasses =
  'w-full rounded-xl border border-espresso-200 bg-paper-white px-4 py-2.5 text-espresso-900 focus:border-honey-500 focus:outline-none focus:ring-2 focus:ring-honey-200';

export function AdminBroadcastForm({ groups }: { groups: { id: string; name: string; memberCount: number }[] }) {
  const [groupId, setGroupId] = useState(groups[0]?.id ?? '');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [isPending, startTransition] = useTransition();

  if (groups.length === 0) {
    return <p className="text-sm text-espresso-400">No groups to broadcast to yet.</p>;
  }

  function submit() {
    setError(null);
    setSent(false);
    startTransition(async () => {
      const result = await sendAdminBroadcast(groupId, title, body);
      if (result.error) {
        setError(result.error);
      } else {
        setSent(true);
        setTitle('');
        setBody('');
      }
    });
  }

  return (
    <div className="space-y-3">
      {error && <p className="text-sm text-danger-700">{error}</p>}
      {sent && <p className="text-sm font-semibold text-success-700">Queued — lands within a minute.</p>}

      <div className="space-y-1.5">
        <label className="block text-xs font-semibold uppercase tracking-wide text-espresso-500">Group</label>
        <select value={groupId} onChange={(e) => setGroupId(e.target.value)} className={inputClasses}>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name} ({g.memberCount} member{g.memberCount === 1 ? '' : 's'})
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-1.5">
        <label className="block text-xs font-semibold uppercase tracking-wide text-espresso-500">Title</label>
        <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={100} className={inputClasses} placeholder="e.g. New ad, tell us what you think" />
      </div>

      <div className="space-y-1.5">
        <label className="block text-xs font-semibold uppercase tracking-wide text-espresso-500">Body</label>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          maxLength={300}
          rows={3}
          className={inputClasses}
          placeholder="What the push notification says"
        />
      </div>

      <Button type="button" disabled={isPending || !title.trim() || !body.trim()} onClick={submit} className="w-full">
        {isPending ? 'Sending…' : 'Send broadcast'}
      </Button>
    </div>
  );
}
