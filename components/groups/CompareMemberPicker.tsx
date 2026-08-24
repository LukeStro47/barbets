'use client';

import { useState, useTransition } from 'react';
import { loadHeadToHead } from '@/lib/actions/memberProfile';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Mention } from '@/components/ui/Mention';
import { HeadToHeadCard } from '@/components/groups/HeadToHeadCard';
import type { HeadToHeadData } from '@/lib/headToHead';

type Step = 'picking' | 'comparing';

/**
 * "Compare with someone" as its own small floating modal with a Back button between its two
 * steps — used only by the full-page member-record route (a direct link, a shared URL, or a hard
 * refresh). The same-app tap path opens the intercepted modal route instead, where
 * `MemberProfileModal` builds this same picking/comparing flow as a sliding step of its own
 * banded panel rather than a separate modal layered on top; a floating popup over another modal
 * would look disconnected there, but is the simplest, self-contained control for this plain page.
 * Both paths fetch the same data (`loadHeadToHead`, see lib/actions/memberProfile.ts) and render
 * the same `HeadToHeadCard`. The standalone `vs/[otherMembershipId]` route still exists too, for a
 * direct link or a refresh straight to a comparison.
 *
 * The viewer's own row is included in `others` (whoever the profile being viewed belongs to is
 * already excluded by the caller) and labelled "@me" rather than their own nickname, so comparing
 * yourself against whoever you're looking at doesn't require hunting for your own name in a list
 * of everyone else's.
 */
export function CompareMemberPicker({
  groupId,
  membershipId,
  others,
  meMembershipId,
}: {
  groupId: string;
  membershipId: string;
  others: { id: string; nickname: string }[];
  meMembershipId: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>('picking');
  const [data, setData] = useState<HeadToHeadData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  if (others.length === 0) return null;

  // Your own row, if present, leads the list — the one entry someone opening this is likely
  // looking for first, rather than buried alphabetically among everyone else's.
  const ordered = [...others].sort((a, b) => (a.id === meMembershipId ? -1 : b.id === meMembershipId ? 1 : 0));

  function openPicker() {
    setStep('picking');
    setData(null);
    setError(null);
    setOpen(true);
  }

  function close() {
    setOpen(false);
  }

  function pick(other: { id: string; nickname: string }) {
    setStep('comparing');
    setError(null);
    startTransition(async () => {
      const result = await loadHeadToHead(groupId, membershipId, other.id);
      if (result.error) setError(result.error);
      else setData(result.data!);
    });
  }

  function back() {
    setStep('picking');
    setData(null);
    setError(null);
  }

  return (
    <>
      <Button type="button" variant="outline" className="w-full" onClick={openPicker}>
        Compare with someone
      </Button>

      {open && (
        <Modal onClose={close} padded={false} panelClassName="flex max-h-[85dvh] flex-col overflow-hidden">
          <div className="flex shrink-0 items-center justify-between gap-3 bg-espresso-50 px-[18px] py-[13px]">
            <p className="text-xs font-extrabold tracking-[0.06em] text-espresso-800 uppercase">
              {step === 'picking' ? 'Compare with' : 'Head to head'}
            </p>
          </div>

          <div className="overflow-y-auto p-[18px]">
            {step === 'picking' ? (
              <div className="space-y-1">
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
            ) : isPending ? (
              <p className="py-6 text-center text-sm text-espresso-400">Loading…</p>
            ) : error ? (
              <p className="py-6 text-center text-sm text-danger-700">{error}</p>
            ) : data ? (
              <HeadToHeadCard data={data} />
            ) : null}
          </div>

          <div className="flex shrink-0 gap-2 border-t border-espresso-50 px-[18px] py-[14px]">
            {step === 'picking' ? (
              <Button type="button" variant="outline" className="flex-1" onClick={close}>
                Cancel
              </Button>
            ) : (
              <>
                <Button type="button" variant="outline" className="flex-1" onClick={back}>
                  Back
                </Button>
                <Button type="button" className="flex-1" onClick={close}>
                  Done
                </Button>
              </>
            )}
          </div>
        </Modal>
      )}
    </>
  );
}
