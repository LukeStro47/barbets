'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { leaveGroup } from '@/lib/actions/groups';
import { Button } from '@/components/ui/Button';

export function LeaveGroupButton({ groupId, groupName }: { groupId: string; groupName: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  if (!confirming) {
    return (
      <Button variant="danger" size="lg" className="w-full" onClick={() => setConfirming(true)}>
        Leave group
      </Button>
    );
  }

  return (
    <div className="space-y-2 rounded-xl border border-danger-100 bg-danger-100/40 p-3 text-center text-sm">
      {error && <p className="text-danger-700">{error}</p>}
      <p className="text-espresso-600">
        Leave {groupName}? Any market about you gets voided and refunded. Your other open bets stay in play and
        settle without you. You will not be reseeded if you return.
      </p>
      <div className="flex gap-2">
        <Button
          variant="outline"
          className="flex-1"
          onClick={() => setConfirming(false)}
        >
          Cancel
        </Button>
        <Button
          variant="danger"
          className="flex-1"
          disabled={isPending}
          onClick={() =>
            startTransition(async () => {
              const result = await leaveGroup(groupId);
              if (result.error) {
                setError(result.error);
              } else {
                router.push('/groups?all=1');
              }
            })
          }
        >
          Confirm, leave
        </Button>
      </div>
    </div>
  );
}
