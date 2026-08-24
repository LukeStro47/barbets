'use client';

import { useState, useTransition } from 'react';
import { loadHeadToHead } from '@/lib/actions/memberProfile';
import { RouteModal } from '@/components/ui/RouteModal';
import { Mention } from '@/components/ui/Mention';
import { MemberProfileCard } from '@/components/groups/MemberProfileCard';
import { HeadToHeadCard } from '@/components/groups/HeadToHeadCard';
import type { MemberProfileData } from '@/lib/memberProfile';
import type { HeadToHeadData } from '@/lib/headToHead';

type Step = 'profile' | 'picking' | 'comparing';

const STEP_INDEX: Record<Step, number> = { profile: 0, picking: 1, comparing: 2 };

/**
 * The intercepted member-record route's actual content: one `RouteModal` panel holding three
 * steps (the record itself, picking who to compare with, the comparison) as a horizontally
 * sliding carousel, so opening a profile, choosing someone, and seeing the result all reads as
 * the same dialog rather than a modal opening a second modal on top of it (which is what a plain
 * `CompareMemberPicker` popup — still used by the full-page fallback route, see its own comment
 * — would look like layered here). Comparison data still comes from `loadHeadToHead` (see
 * lib/actions/memberProfile.ts); only the presentation changed.
 *
 * The header's back chevron always returns to the `profile` step regardless of which of the other
 * two steps is showing — going back from a comparison re-opens the picker only if the visitor
 * taps "Compare with someone" again, it does not require re-traversing the picker to get home.
 * The close X (from `RouteModal`) always closes the whole dialog via `router.back()`, independent
 * of which step is showing.
 */
export function MemberProfileModal({ data }: { data: MemberProfileData }) {
  const [step, setStep] = useState<Step>('profile');
  const [compareData, setCompareData] = useState<HeadToHeadData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const { groupId, others, meMembershipId, isYou } = data;
  const membershipId = data.stats.membership_id;

  // The viewer's own row, if present, leads the list — the one entry someone opening this is
  // likely looking for first, rather than buried alphabetically among everyone else's.
  const ordered = [...others].sort((a, b) => (a.id === meMembershipId ? -1 : b.id === meMembershipId ? 1 : 0));

  function startCompare() {
    setStep('picking');
    setCompareData(null);
    setError(null);
  }

  function pick(other: { id: string; nickname: string }) {
    setStep('comparing');
    setError(null);
    startTransition(async () => {
      const result = await loadHeadToHead(groupId, membershipId, other.id);
      if (result.error) setError(result.error);
      else setCompareData(result.data!);
    });
  }

  function backToProfile() {
    setStep('profile');
    setCompareData(null);
    setError(null);
  }

  const title = step === 'profile' ? (isYou ? 'Your record' : 'Member record') : step === 'picking' ? 'Compare with' : 'Head to head';

  return (
    <RouteModal title={title} onBack={step !== 'profile' ? backToProfile : undefined} padded={false}>
      <div className="flex transition-transform duration-300 ease-out" style={{ width: '300%', transform: `translateX(-${STEP_INDEX[step] * (100 / 3)}%)` }}>
        <div className="w-full shrink-0 space-y-5 p-5" style={{ width: `${100 / 3}%` }}>
          <MemberProfileCard data={data} />
          {others.length > 0 && (
            <button
              type="button"
              onClick={startCompare}
              className="w-full rounded-[10px] border border-espresso-200 px-4 py-2.5 text-sm font-bold text-espresso-700 hover:bg-espresso-50"
            >
              Compare with someone
            </button>
          )}
        </div>

        <div className="w-full shrink-0 space-y-1 p-[18px]" style={{ width: `${100 / 3}%` }}>
          {ordered.map((m) => (
            <button
              key={m.id}
              type="button"
              className="flex w-full items-center rounded-xl px-3 py-2.5 text-left hover:bg-espresso-50"
              onClick={() => pick(m)}
            >
              <Mention nickname={m.id === meMembershipId ? 'me' : m.nickname} className="font-semibold text-espresso-900" />
            </button>
          ))}
        </div>

        <div className="w-full shrink-0 p-[18px]" style={{ width: `${100 / 3}%` }}>
          {isPending ? (
            <p className="py-6 text-center text-sm text-espresso-400">Loading…</p>
          ) : error ? (
            <p className="py-6 text-center text-sm text-danger-700">{error}</p>
          ) : compareData ? (
            <HeadToHeadCard data={compareData} />
          ) : null}
        </div>
      </div>
    </RouteModal>
  );
}
