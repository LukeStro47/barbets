'use client';

import { useState, useTransition } from 'react';
import { deleteAccount } from '@/lib/actions/profile';
import { Button } from '@/components/ui/Button';

const inputClasses =
  'w-full rounded-xl border border-espresso-200 bg-paper-white px-4 py-2.5 text-espresso-900 placeholder:text-espresso-300 focus:border-honey-500 focus:outline-none focus:ring-2 focus:ring-honey-200';

/** Same effect as remove_member() run on yourself, everywhere you're a member, then the auth account itself is gone. Blocked while you still own a group. */
export function DeleteAccountButton() {
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  if (!confirming) {
    return (
      <Button variant="danger" className="w-full" onClick={() => setConfirming(true)}>
        Delete account
      </Button>
    );
  }

  return (
    <div className="space-y-2">
      {error && <p className="text-sm text-danger-700">{error}</p>}
      <p className="text-sm text-espresso-600">
        This refunds your open bets, removes you from every group, and permanently deletes your account. Groups you
        own need to be transferred or deleted first. Type DELETE to confirm.
      </p>
      <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="DELETE" className={inputClasses} />
      <div className="flex gap-2">
        <Button
          variant="outline"
          className="flex-1"
          onClick={() => {
            setConfirming(false);
            setTyped('');
          }}
        >
          Cancel
        </Button>
        <Button
          variant="danger"
          className="flex-1"
          disabled={isPending || typed !== 'DELETE'}
          onClick={() =>
            startTransition(async () => {
              const result = await deleteAccount();
              if (result?.error) {
                setError(result.error);
              }
            })
          }
        >
          Delete forever
        </Button>
      </div>
    </div>
  );
}
