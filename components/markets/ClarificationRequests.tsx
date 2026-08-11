'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { requestClarification, updateResolutionCriteria } from '@/lib/actions/resolution';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Mention } from '@/components/ui/Mention';
import type { Market } from '@/lib/actions/markets';

const inputClasses =
  'w-full rounded-xl border border-espresso-200 bg-paper-white px-4 py-2.5 text-espresso-900 focus:border-honey-500 focus:outline-none focus:ring-2 focus:ring-honey-200';

export interface Clarification {
  id: string;
  nickname: string;
  question: string;
}

interface Props {
  groupId: string;
  marketId: string;
  status: Market['status'];
  description: string;
  isCreator: boolean;
  clarifications: Clarification[];
  /**
   * 'corner' — the circular "?" in the How-it-settles card's top-right, absolutely positioned
   * into its parent. 'panel' — the endorsement screen's dashed stand-alone panel, where asking
   * is a real third option next to Endorse it / Not now and so needs to be legible as one rather
   * than hidden behind a glyph.
   */
  variant?: 'corner' | 'panel';
  /** 'panel' only: whose wording the endorser would be asking about. */
  creatorNickname?: string;
}

/**
 * Lives inside the resolution criteria card. Any non-creator member can ask
 * a question via the circular "?" trigger in the card's top-right corner,
 * which opens the shared Modal (same one ResolutionProofButton etc. use)
 * while the market is `open`; once the creator has at least one pending
 * question, they get an inline editor to tighten the description, the only
 * way `description` can ever change post-creation. A successful update
 * clears every pending question at once (they don't linger as history, the
 * updated description is the answer). Both controls disappear once betting
 * isn't open anymore.
 */
export function ClarificationRequests({
  groupId,
  marketId,
  status,
  description,
  isCreator,
  clarifications,
  variant = 'corner',
  creatorNickname,
}: Props) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [asking, setAsking] = useState(false);
  const [question, setQuestion] = useState('');
  const [editing, setEditing] = useState(false);
  const [draftDescription, setDraftDescription] = useState(description);

  const hasPending = clarifications.length > 0;
  // Matches request_clarification/update_resolution_criteria's own gate (widened to
  // pending_sponsor in 20260811120000): an endorser has to be able to ask what a vague criterion
  // means *before* they vouch for it, not only after.
  const canAct = status === 'open' || status === 'pending_sponsor';

  function submitQuestion() {
    if (!question.trim()) return;
    setError(null);
    startTransition(async () => {
      const result = await requestClarification(groupId, marketId, question.trim());
      if (result.error) {
        setError(result.error);
      } else {
        setQuestion('');
        setAsking(false);
        router.refresh();
      }
    });
  }

  function submitUpdate() {
    if (!draftDescription.trim()) return;
    setError(null);
    startTransition(async () => {
      const result = await updateResolutionCriteria(groupId, marketId, draftDescription.trim());
      if (result.error) {
        setError(result.error);
      } else {
        setEditing(false);
        router.refresh();
      }
    });
  }

  if (!hasPending && !canAct) return null;

  const askModal = asking && (
    <Modal onClose={() => setAsking(false)}>
      <p className="font-display font-bold text-espresso-900">Ask for clarification</p>
      <p className="text-sm text-espresso-500">
        Flag anything unclear about how this resolves. Your question is visible to the group, and the creator gets
        notified. Updating the criteria clears every open question at once.
      </p>
      <textarea
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
        placeholder="What's unclear about the criteria?"
        rows={3}
        autoFocus
        className={inputClasses}
      />
      {error && <p className="text-sm text-danger-700">{error}</p>}
      <div className="flex gap-2">
        <Button variant="outline" className="flex-1" onClick={() => setAsking(false)}>
          Cancel
        </Button>
        <Button className="flex-1" disabled={isPending || !question.trim()} onClick={submitQuestion}>
          Send
        </Button>
      </div>
    </Modal>
  );

  if (variant === 'panel') {
    return (
      <>
        {canAct && !isCreator && (
          <div className="space-y-3 rounded-[20px] border border-dashed border-espresso-200 bg-paper-white px-[18px] py-4">
            <div className="flex items-start gap-2.5">
              <span className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[11px] bg-espresso-50 text-[15px] font-extrabold text-espresso-600">
                ?
              </span>
              <div className="flex-1">
                <p className="text-[15.5px] font-extrabold text-espresso-950">Something ambiguous?</p>
                <p className="mt-0.5 text-[13.5px] leading-[1.45] text-espresso-500">
                  Ask {creatorNickname ? <Mention nickname={creatorNickname} /> : 'the creator'} to tighten the criteria
                  before you put your name on it.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setAsking(true)}
              className="w-full rounded-full border border-espresso-200 px-4 py-2.5 text-sm font-semibold text-espresso-800 transition-colors hover:bg-espresso-50"
            >
              Ask for a clarification
            </button>
          </div>
        )}
        {askModal}
        {hasPending && <PendingList clarifications={clarifications} />}
        {hasPending && canAct && isCreator && (
          <CriteriaEditor
            editing={editing}
            setEditing={setEditing}
            draftDescription={draftDescription}
            setDraftDescription={setDraftDescription}
            error={error}
            isPending={isPending}
            onSave={submitUpdate}
          />
        )}
      </>
    );
  }

  return (
    <>
      {canAct && !isCreator && (
        <div className="absolute top-3 right-3">
          <button
            type="button"
            onClick={() => setAsking(true)}
            aria-label="Ask for clarification"
            className="flex h-8 w-8 items-center justify-center rounded-full bg-espresso-50 text-sm font-bold text-espresso-500 ring-1 ring-espresso-100 hover:bg-espresso-100"
          >
            ?
          </button>

          {askModal}
        </div>
      )}

      {hasPending && (
        <div className="space-y-2.5 border-t border-espresso-100 pt-3">
          <PendingList clarifications={clarifications} />
          {canAct && isCreator && (
            <CriteriaEditor
              editing={editing}
              setEditing={setEditing}
              draftDescription={draftDescription}
              setDraftDescription={setDraftDescription}
              error={error}
              isPending={isPending}
              onSave={submitUpdate}
            />
          )}
        </div>
      )}
    </>
  );
}

function PendingList({ clarifications }: { clarifications: Clarification[] }) {
  return (
    <ul className="space-y-1.5">
      {clarifications.map((c) => (
        <li key={c.id} className="rounded-xl bg-espresso-50 px-3 py-2 text-sm">
          <p className="text-espresso-600">
            <Mention nickname={c.nickname} /> asked: {c.question}
          </p>
          <span className="mt-1 inline-flex items-center rounded-full bg-danger-100 px-2 py-0.5 text-[11px] font-semibold text-danger-700">
            Needs clarification
          </span>
        </li>
      ))}
    </ul>
  );
}

function CriteriaEditor({
  editing,
  setEditing,
  draftDescription,
  setDraftDescription,
  error,
  isPending,
  onSave,
}: {
  editing: boolean;
  setEditing: (v: boolean) => void;
  draftDescription: string;
  setDraftDescription: (v: string) => void;
  error: string | null;
  isPending: boolean;
  onSave: () => void;
}) {
  return (
    <div className="space-y-2">
      {!editing ? (
        <>
          <p className="text-xs text-espresso-500">
            Updating the criteria answers every question above at once, and everyone in the group gets notified.
          </p>
          <Button variant="outline" className="w-full" onClick={() => setEditing(true)}>
            Update resolution criteria
          </Button>
        </>
      ) : (
        <>
          <textarea value={draftDescription} onChange={(e) => setDraftDescription(e.target.value)} rows={3} className={inputClasses} />
          {error && <p className="text-xs text-danger-700">{error}</p>}
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <Button className="flex-1" disabled={isPending || !draftDescription.trim()} onClick={onSave}>
              Save
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
