'use client';

import { useCallback, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { updateGroupSettings, type GroupSettings } from '@/lib/actions/groups';
import { groupSettingsInput } from '@/lib/groupManage';
import { PageHeader } from '@/components/ui/PageHeader';
import { SettingsCard } from '@/components/ui/SettingsList';
import { StakesCard } from '@/components/groups/StakesCard';
import { Button } from '@/components/ui/Button';
import { PRIZE_MAX_LENGTH, PUNISHMENT_MAX_LENGTH } from '@/lib/limits';

const inputClasses =
  'w-full rounded-[10px] border border-espresso-200 bg-paper-white px-3.5 py-2.5 text-[15px] font-bold text-espresso-950 focus:border-honey-500 focus:outline-none focus:ring-2 focus:ring-honey-200';

export function StakesEditor({
  groupId,
  settings,
  isPublic,
  canEdit,
  chrome = 'page',
  backLabel = 'Manage group',
}: {
  groupId: string;
  settings: GroupSettings;
  isPublic: boolean;
  canEdit: boolean;
  chrome?: 'page' | 'modal';
  backLabel?: string;
}) {
  const router = useRouter();
  const [committed, setCommitted] = useState(settings);
  const [prizeText, setPrizeText] = useState(settings.prize_text ?? '');
  const [punishmentText, setPunishmentText] = useState(settings.punishment_text ?? '');
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  const committedRef = useRef(committed);
  const prizeRef = useRef(prizeText);
  const punishmentRef = useRef(punishmentText);
  const retryRef = useRef<{ prize: string; punishment: string } | null>(null);
  const queueRef = useRef(Promise.resolve());
  committedRef.current = committed;
  prizeRef.current = prizeText;
  punishmentRef.current = punishmentText;

  const nextPrize = prizeText.trim();
  const nextPunishment = punishmentText.trim();
  const dirty = nextPrize !== (committed.prize_text ?? '') || nextPunishment !== (committed.punishment_text ?? '');

  const persist = useCallback(() => {
    const snapshot = committedRef.current;
    const prize = prizeRef.current.trim();
    const punishment = punishmentRef.current.trim();
    if ((snapshot.prize_text ?? '') === prize && (snapshot.punishment_text ?? '') === punishment) return;

    queueRef.current = queueRef.current.then(async () => {
      const snapshot = committedRef.current;
      const prize = prizeRef.current.trim();
      const punishment = punishmentRef.current.trim();
      setSaveState('saving');
      const result = await updateGroupSettings(
        groupId,
        groupSettingsInput(snapshot, isPublic, {
          prizeText: prize ? prize : null,
          punishmentText: punishment ? punishment : null,
        })
      );
      if (result.error || !result.data) {
        retryRef.current = { prize: prizeRef.current, punishment: punishmentRef.current };
        setSaveState('error');
        return;
      }
      setCommitted(result.data);
      committedRef.current = result.data;
      setPrizeText(result.data.prize_text ?? '');
      setPunishmentText(result.data.punishment_text ?? '');
      prizeRef.current = result.data.prize_text ?? '';
      punishmentRef.current = result.data.punishment_text ?? '';
      retryRef.current = null;
      setSaveState('saved');
      router.refresh();
    });
  }, [groupId, isPublic, router]);

  function retry() {
    if (retryRef.current) {
      setPrizeText(retryRef.current.prize);
      setPunishmentText(retryRef.current.punishment);
      prizeRef.current = retryRef.current.prize;
      punishmentRef.current = retryRef.current.punishment;
    }
    persist();
  }

  if (!canEdit) {
    const empty = <p className="text-sm text-espresso-400">No prize or punishment set.</p>;
    const body = settings.prize_text || settings.punishment_text ? (
      <StakesCard prizeText={settings.prize_text} punishmentText={settings.punishment_text} />
    ) : (
      empty
    );
    if (chrome === 'modal') {
      return (
        <>
          <p className="font-display text-lg font-extrabold tracking-[-0.015em] text-espresso-950">Prize / Punishment</p>
          {body}
        </>
      );
    }
    return (
      <>
        <PageHeader title="Prize / Punishment" backHref={`/groups/${groupId}/settings`} backLabel={backLabel} />
        {body}
      </>
    );
  }

  const fields = (
    <div className={chrome === 'modal' ? 'space-y-2.5' : 'space-y-3 px-4 py-3.5'}>
      <div>
        <label className="block text-sm font-semibold text-espresso-800" htmlFor="prize-text">
          Prize
        </label>
        <p className="mt-0.5 mb-1.5 text-xs leading-[1.45] text-espresso-400">What first place gets. Leave blank for none.</p>
        <textarea
          id="prize-text"
          value={prizeText}
          onChange={(e) => {
            setPrizeText(e.target.value);
            setSaveState('idle');
          }}
          maxLength={PRIZE_MAX_LENGTH}
          rows={2}
          placeholder="Winner picks the next group outing."
          className={inputClasses}
        />
        <span className="mt-0.5 block text-right text-[11px] text-espresso-400">
          {prizeText.length} / {PRIZE_MAX_LENGTH}
        </span>
      </div>
      <div>
        <label className="block text-sm font-semibold text-espresso-800" htmlFor="punishment-text">
          Punishment
        </label>
        <p className="mt-0.5 mb-1.5 text-xs leading-[1.45] text-espresso-400">What last place owes. Leave blank for none.</p>
        <textarea
          id="punishment-text"
          value={punishmentText}
          onChange={(e) => {
            setPunishmentText(e.target.value);
            setSaveState('idle');
          }}
          maxLength={PUNISHMENT_MAX_LENGTH}
          rows={2}
          placeholder="Loser buys the first round next time."
          className={inputClasses}
        />
        <span className="mt-0.5 block text-right text-[11px] text-espresso-400">
          {punishmentText.length} / {PUNISHMENT_MAX_LENGTH}
        </span>
      </div>
    </div>
  );

  const saveControls = (
    <div className={chrome === 'modal' ? 'pt-1' : 'px-0.5'}>
      {saveState === 'error' && (
        <p className="mb-2 text-sm text-danger-700">
          Not saved.{' '}
          <button type="button" onClick={retry} className="font-bold underline">
            Retry
          </button>
        </p>
      )}
      {saveState === 'saved' && !dirty && <p className="mb-2 text-sm text-honey-700">Saved.</p>}
      <Button
        type="button"
        className="w-full"
        disabled={!dirty || saveState === 'saving'}
        onClick={() => persist()}
      >
        {saveState === 'saving' ? 'Saving…' : 'Save'}
      </Button>
    </div>
  );

  if (chrome === 'modal') {
    return (
      <>
        <p className="font-display text-lg font-extrabold tracking-[-0.015em] text-espresso-950">Prize / Punishment</p>
        {fields}
        {saveControls}
      </>
    );
  }

  return (
    <>
      <PageHeader title="Prize / Punishment" backHref={`/groups/${groupId}/settings`} backLabel={backLabel} />
      <SettingsCard>{fields}</SettingsCard>
      {saveControls}
    </>
  );
}
