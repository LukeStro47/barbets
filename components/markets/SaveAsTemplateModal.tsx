'use client';

import { useMemo, useState, useTransition } from 'react';
import { saveMarketTemplate } from '@/lib/actions/marketTemplates';
import { detectPlaceholderInTitle, stripLeadingMention } from '@/lib/marketTemplatePlaceholder';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import type { MarketType } from '@/lib/marketType';
import type { MemberOption } from '@/components/markets/MarketForms';
import { cn } from '@/lib/cn';

interface Candidate {
  /** The title text to default the name field to — with the placeholder already swapped in
   * when one was found. */
  title: string;
  /** multiple_choice only; already carries any @ swap. */
  options: string[] | null;
  /** True when `title`/`options` above already have a clean, deterministic placeholder swap
   * (the multiple_choice case) that needs no confirmation. */
  hasCleanPlaceholder: boolean;
  /** True only for the yes_no/over_under heuristic match, which is a guess and always shown
   * back to the saver as an editable, confirmable step before it's trusted. */
  needsConfirm: boolean;
}

/** Turns whatever the wizard currently has into a savable template shape. multiple_choice is
 * deterministic (an @-mentioned option is structurally unambiguous); yes_no/over_under relies on
 * a best-effort literal name match in the title, which is why that path alone needs confirming. */
function buildCandidate(marketType: MarketType, draftTitle: string, options: string[], subjects: MemberOption[]): Candidate {
  if (marketType === 'multiple_choice') {
    const mentionIndexes = options.reduce<number[]>((acc, o, i) => (o.trim().startsWith('@') ? [...acc, i] : acc), []);
    if (mentionIndexes.length === 1) {
      const [i] = mentionIndexes;
      return {
        title: draftTitle,
        options: options.map((o, idx) => (idx === i ? '@' : stripLeadingMention(o))),
        hasCleanPlaceholder: true,
        needsConfirm: false,
      };
    }
    // Zero mentions, or more than one (can't represent more than one placeholder) — flatten any
    // stray "@nickname" text back to plain, and save without a placeholder. Never blocks the save.
    return { title: draftTitle, options: options.map(stripLeadingMention), hasCleanPlaceholder: false, needsConfirm: false };
  }

  if (subjects.length === 1) {
    const { title, matched } = detectPlaceholderInTitle(draftTitle, subjects[0].nickname);
    if (matched) {
      return { title, options: null, hasCleanPlaceholder: true, needsConfirm: true };
    }
  }
  return { title: draftTitle, options: null, hasCleanPlaceholder: false, needsConfirm: false };
}

const fieldLabelClasses = 'text-[10.5px] font-extrabold tracking-[0.1em] text-espresso-400 uppercase';

export function SaveAsTemplateModal({
  groupId,
  groupName,
  draftTitle,
  description,
  marketType,
  options,
  subjects,
  unit,
  onClose,
}: {
  groupId: string;
  groupName: string;
  draftTitle: string;
  description: string;
  marketType: MarketType;
  /** Trimmed option labels, multiple_choice only (ignored otherwise). */
  options: string[];
  subjects: MemberOption[];
  /** over_under only. */
  unit: string | null;
  onClose: () => void;
}) {
  // Computed once, from the draft as it stood the moment "Save as template" was tapped —
  // re-deriving it on every keystroke of the wizard behind this modal would be pointless churn.
  const candidate = useMemo(
    () => buildCandidate(marketType, draftTitle, options, subjects),
    [] // eslint-disable-line react-hooks/exhaustive-deps
  );

  const [step, setStep] = useState<'confirm' | 'details'>(candidate.needsConfirm ? 'confirm' : 'details');
  const [proposedTitle, setProposedTitle] = useState(candidate.title);
  const [name, setName] = useState(candidate.title);
  const [scope, setScope] = useState<'private' | 'group'>('private');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [isPending, startTransition] = useTransition();

  function skipSwap() {
    setName(draftTitle);
    setStep('details');
  }

  function continueFromConfirm() {
    setName(proposedTitle);
    setStep('details');
  }

  function save() {
    setError(null);
    startTransition(async () => {
      const result = await saveMarketTemplate({
        groupId,
        scope,
        title: name.trim(),
        description,
        marketType,
        options: candidate.options ?? undefined,
        unit,
      });
      if (result.error) setError(result.error);
      else setSaved(true);
    });
  }

  if (saved) {
    return (
      <Modal onClose={onClose}>
        <p className="font-display font-bold text-espresso-900">Saved</p>
        <p className="text-sm leading-[1.5] text-espresso-600">
          Find it from + · Browse templates{scope === 'group' ? `, shared with ${groupName}` : ''}.
        </p>
        <Button className="w-full" onClick={onClose}>
          Done
        </Button>
      </Modal>
    );
  }

  if (step === 'confirm') {
    return (
      <Modal onClose={onClose}>
        <p className="font-display text-lg font-extrabold text-espresso-950">Save as template</p>
        <p className="text-[13.5px] leading-[1.5] text-espresso-600">
          You picked one person for this bet. Swap their name for a fill-in-the-blank so you can pick anyone next
          time.
        </p>

        <div className="rounded-2xl border-[1.5px] border-honey-400 bg-paper-white px-3.5 py-3">
          <p className={fieldLabelClasses}>Title</p>
          <textarea
            value={proposedTitle}
            onChange={(e) => setProposedTitle(e.target.value)}
            rows={2}
            className="mt-1.5 block w-full resize-none border-0 bg-transparent p-0 text-[15px] font-semibold text-espresso-950 focus:outline-none"
          />
        </div>
        <p className="text-[12px] leading-[1.45] text-espresso-400">
          We swapped out {subjects[0]?.nickname}&apos;s name, edit the text above if that&apos;s not quite right.
        </p>

        <button type="button" onClick={skipSwap} className="border-0 bg-transparent p-0 text-[12.5px] font-extrabold text-honey-700">
          Save without the swap
        </button>

        <div className="flex gap-2 pt-1">
          <Button type="button" variant="outline" className="flex-1" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" className="flex-1" onClick={continueFromConfirm} disabled={!proposedTitle.trim()}>
            Continue
          </Button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal onClose={onClose}>
      <p className="font-display text-lg font-extrabold text-espresso-950">Save as template</p>
      {error && <p className="text-sm text-danger-700">{error}</p>}

      <div>
        <p className={fieldLabelClasses}>Template name</p>
        <div className="mt-1.5 rounded-2xl border-[1.5px] border-espresso-200 px-3.5 py-3">
          <textarea
            value={name}
            onChange={(e) => setName(e.target.value)}
            rows={2}
            className="block w-full resize-none border-0 bg-transparent p-0 text-[14.5px] font-semibold text-espresso-950 focus:outline-none"
          />
        </div>
      </div>

      <div>
        <p className={fieldLabelClasses}>Who can use this?</p>
        <div className="mt-1.5 flex flex-col gap-2">
          <button
            type="button"
            onClick={() => setScope('private')}
            className={cn(
              'rounded-2xl border-[1.5px] px-3.5 py-3 text-left text-sm font-extrabold',
              scope === 'private' ? 'border-honey-500 bg-honey-50 text-honey-800' : 'border-espresso-200 text-espresso-700'
            )}
          >
            Just me
          </button>
          <button
            type="button"
            onClick={() => setScope('group')}
            className={cn(
              'rounded-2xl border-[1.5px] px-3.5 py-3 text-left text-sm font-extrabold',
              scope === 'group' ? 'border-honey-500 bg-honey-50 text-honey-800' : 'border-espresso-200 text-espresso-700'
            )}
          >
            Share with {groupName}
          </button>
        </div>
      </div>

      <div className="flex gap-2 pt-1">
        <Button type="button" variant="outline" className="flex-1" onClick={onClose}>
          Cancel
        </Button>
        <Button type="button" className="flex-1" disabled={isPending || !name.trim()} onClick={save}>
          {isPending ? 'Saving…' : 'Save template'}
        </Button>
      </div>
    </Modal>
  );
}
