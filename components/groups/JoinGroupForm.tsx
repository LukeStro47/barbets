'use client';

import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';

/** Just routes to the same /join/[code] flow the invite link uses, so there's only one join experience (group confirm, then a dedicated nickname step) instead of a second, cramped one. */
export function JoinGroupForm() {
  const router = useRouter();

  function handleJoin(formData: FormData) {
    const code = String(formData.get('inviteCode')).trim();
    if (code) router.push(`/join/${encodeURIComponent(code)}`);
  }

  return (
    <form action={handleJoin} className="flex gap-2">
      <input
        name="inviteCode"
        placeholder="BB-XXXX"
        required
        className="min-w-0 flex-1 rounded-full border border-espresso-200 bg-paper-white px-4 py-2 text-espresso-900 placeholder:text-espresso-300 focus:border-honey-500 focus:outline-none focus:ring-2 focus:ring-honey-200"
      />
      <Button type="submit" variant="outline">
        Join
      </Button>
    </form>
  );
}
