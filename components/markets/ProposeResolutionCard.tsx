'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Capacitor } from '@capacitor/core';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import { proposeResolution } from '@/lib/actions/resolution';
import { compressImage } from '@/lib/compressImage';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { TicketCard } from '@/components/markets/TicketCard';
import { OptionLabel } from '@/components/markets/OptionLabel';
import { CameraIcon, CheckIcon, ImageIcon } from '@/components/ui/icons';
import { formatLine } from '@/lib/units';
import { cn } from '@/lib/cn';
import type { Market, MarketOption } from '@/lib/actions/markets';

const inputClasses =
  'w-full rounded-xl border border-espresso-200 bg-paper-white px-4 py-2.5 text-espresso-900 focus:border-honey-500 focus:outline-none focus:ring-2 focus:ring-honey-200';

/**
 * The "propose what happened" trigger and its two-step modal (pick the answer, then read a
 * plain-language consequence before confirming). Works the same whether the market is still
 * `open` (proposing closes betting immediately for everyone) or already `closed`; only the
 * button's wording changes.
 *
 * Renders as a bare outlined button with no card, divider, or copy of its own, because it is
 * always handed to `ResolutionTimeline` as that stage's one action — the steps directly above it
 * are the explanation, so repeating them here would say the same thing twice. Outlined rather
 * than filled so that on an open market it never looks like it belongs where betting does.
 */
export function ProposeResolutionCard({
  groupId,
  market,
  options,
  resolutionWindowHours,
}: {
  groupId: string;
  market: Market;
  options: MarketOption[] | null;
  resolutionWindowHours: number;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const isMultipleChoice = market.market_type === 'multiple_choice';
  const [modalOpen, setModalOpen] = useState(false);
  const [step, setStep] = useState<'choose' | 'review'>('choose');
  const [proposeOutcome, setProposeOutcome] = useState<string | null>(null);
  const [justification, setJustification] = useState('');
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    return () => {
      if (photoPreview) URL.revokeObjectURL(photoPreview);
    };
  }, [photoPreview]);

  async function applyPhotoFile(file: File) {
    const compressed = await compressImage(file);
    if (photoPreview) URL.revokeObjectURL(photoPreview);
    setPhotoFile(compressed);
    setPhotoPreview(URL.createObjectURL(compressed));
  }

  async function handlePhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError(null);
    setPhotoBusy(true);
    try {
      await applyPhotoFile(file);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not process that photo.');
    } finally {
      setPhotoBusy(false);
    }
  }

  /** Inside the native shell, the HTML file input's `capture` attribute is unreliable (on this
   * device it just opened the gallery) — `@capacitor/camera` talks to the real native camera/
   * gallery pickers instead. Falls back to the file inputs everywhere else (web, PWA). */
  async function captureNativePhoto(source: CameraSource) {
    setError(null);
    setPhotoBusy(true);
    try {
      const photo = await Camera.getPhoto({ resultType: CameraResultType.Uri, source, quality: 90 });
      if (!photo.webPath) throw new Error('No photo came back.');
      const blob = await (await fetch(photo.webPath)).blob();
      const file = new File([blob], `proof.${photo.format ?? 'jpeg'}`, { type: blob.type || `image/${photo.format ?? 'jpeg'}` });
      await applyPhotoFile(file);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // The plugin rejects on cancel too (e.g. "User cancelled photos app") - that's not a real error.
      if (!/cancel/i.test(message)) setError(message);
    } finally {
      setPhotoBusy(false);
    }
  }

  function handleTakePhotoClick() {
    if (Capacitor.isNativePlatform()) captureNativePhoto(CameraSource.Camera);
    else cameraInputRef.current?.click();
  }

  function handleChoosePhotoClick() {
    if (Capacitor.isNativePlatform()) captureNativePhoto(CameraSource.Photos);
    else fileInputRef.current?.click();
  }

  function removePhoto() {
    if (photoPreview) URL.revokeObjectURL(photoPreview);
    setPhotoFile(null);
    setPhotoPreview(null);
  }

  const sides = market.market_type === 'yes_no' ? (['yes', 'no'] as const) : (['over', 'under'] as const);
  const lineLabel = market.market_type === 'over_under' ? formatLine(market.line, market.unit) : null;
  /** VOID is deliberately not in this list — it is a real choice but not a real outcome, so it
   * renders under its own divider rather than as a fourth peer. */
  const outcomeChoices: { value: string; label: string }[] = isMultipleChoice
    ? (options ?? []).map((o) => ({ value: o.id, label: o.label }))
    : sides.map((s) => ({ value: s, label: `${s.toUpperCase()}${lineLabel ? ` ${lineLabel}` : ''}` }));
  const choiceLabels = [...outcomeChoices, { value: 'void', label: 'VOID' }];

  const kindLabel = isMultipleChoice
    ? `One of ${(options ?? []).length} options`
    : market.market_type === 'over_under'
      ? `Over / Under · line ${lineLabel}`
      : 'Yes / No';

  // Same rule ResolutionTimeline uses, so the two never disagree about the same window.
  const windowLabel = resolutionWindowHours < 1 ? `${Math.round(resolutionWindowHours * 60)} minutes` : `${resolutionWindowHours} hours`;

  function proposalChoiceFor(value: string) {
    return isMultipleChoice && value !== 'void'
      ? ({ optionId: value } as const)
      : ({ outcome: value as 'yes' | 'no' | 'over' | 'under' | 'void' } as const);
  }

  function openModal() {
    setError(null);
    setStep('choose');
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
    setStep('choose');
    setProposeOutcome(null);
    setJustification('');
    removePhoto();
    setError(null);
  }

  function submit() {
    if (!proposeOutcome) return;
    setError(null);
    startTransition(async () => {
      let photo: FormData | undefined;
      if (photoFile) {
        photo = new FormData();
        photo.append('photo', photoFile);
      }
      const result = await proposeResolution(
        groupId,
        market.id,
        proposalChoiceFor(proposeOutcome),
        justification || undefined,
        undefined,
        photo
      );
      if (result.error) {
        setError(result.error);
      } else {
        setModalOpen(false);
        router.refresh();
      }
    });
  }

  const chosenLabel = (choiceLabels.find((c) => c.value === proposeOutcome)?.label ?? '').toUpperCase();

  return (
    <>
      {/* "early" only while betting is still open, where proposing is what closes it. On an
          already-closed market there is nothing early about it — it is just the next step. */}
      <button
        type="button"
        onClick={openModal}
        className="w-full rounded-full border border-espresso-200 px-4 py-2.5 text-sm font-semibold text-espresso-600 transition-colors hover:bg-espresso-50"
      >
        {market.status === 'open' ? 'Propose result early' : 'Propose the outcome'}
      </button>

      {modalOpen && (
        <Modal onClose={closeModal} padded={false} panelClassName="max-h-[85dvh] overflow-x-hidden overflow-y-auto">
          <div className="flex items-center justify-between gap-3 bg-espresso-50 px-[18px] py-[13px]">
            <p className="text-xs font-extrabold tracking-[0.06em] text-espresso-800 uppercase">Call the result</p>
            <p className="shrink-0 text-xs font-semibold text-espresso-500">Step {step === 'choose' ? 1 : 2} of 2</p>
          </div>

          {step === 'choose' ? (
            <>
              <div className="flex flex-col gap-3.5 p-[18px]">
                <div>
                  <p className="font-display text-[19px] font-extrabold tracking-[-0.01em] text-espresso-900">
                    What actually happened?
                  </p>
                  <p className="mt-1 text-[13.5px] leading-[1.45] text-espresso-500">
                    This is the result, not a bet. Pick what the group should settle on.
                  </p>
                </div>

                {error && <p className="text-sm text-danger-700">{error}</p>}

                {/* Rows rather than a wrap of pills: this is the one irreversible choice in the
                    flow, and a row per outcome makes "which one is selected" readable without
                    hunting for a colour change on a small chip. */}
                <div className="flex flex-col gap-2">
                  {outcomeChoices.map((c) => (
                    <OutcomeRow
                      key={c.value}
                      selected={proposeOutcome === c.value}
                      onClick={() => setProposeOutcome(c.value)}
                    >
                      <span className="min-w-0 flex-1 text-left text-[15.5px] font-extrabold tracking-[0.02em]">
                        <OptionLabel label={c.label} />
                      </span>
                    </OutcomeRow>
                  ))}

                  {/* VOID refunds everyone rather than settling anything, so it sits under a
                      divider and in a dashed outline: available, but never mistaken for one of
                      the market's own answers. */}
                  <div className="border-t border-espresso-50 pt-2.5">
                    <OutcomeRow selected={proposeOutcome === 'void'} onClick={() => setProposeOutcome('void')} dashed>
                      <span className="min-w-0 flex-1 text-left">
                        <span className="block text-sm font-extrabold tracking-[0.02em]">VOID</span>
                        <span className="block text-xs text-espresso-400">Refunds bets</span>
                      </span>
                    </OutcomeRow>
                  </div>
                </div>

                <div className="flex flex-col gap-1.5">
                  <p className="text-[11.5px] font-extrabold tracking-[0.08em] text-espresso-400 uppercase">Why, optional</p>
                  <textarea
                    value={justification}
                    onChange={(e) => setJustification(e.target.value)}
                    placeholder="Helps everyone trust the call"
                    rows={2}
                    className={inputClasses}
                  />

                  <input ref={fileInputRef} type="file" accept="image/*" onChange={handlePhotoChange} className="hidden" />
                  <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" onChange={handlePhotoChange} className="hidden" />
                  {photoPreview ? (
                    <div className="flex items-center gap-3">
                      <img src={photoPreview} alt="Proof preview" className="h-16 w-16 rounded-lg object-cover" />
                      <Button type="button" variant="outline" size="sm" onClick={removePhoto}>
                        Remove photo
                      </Button>
                    </div>
                  ) : (
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        disabled={photoBusy}
                        onClick={handleTakePhotoClick}
                        className="inline-flex flex-1 items-center justify-center gap-2"
                      >
                        <CameraIcon className="h-4 w-4" />
                        {photoBusy ? 'Processing…' : 'Take a photo'}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        disabled={photoBusy}
                        onClick={handleChoosePhotoClick}
                        className="inline-flex flex-1 items-center justify-center gap-2"
                      >
                        <ImageIcon className="h-4 w-4" />
                        Choose photo
                      </Button>
                    </div>
                  )}
                </div>
              </div>

              <div className="flex gap-2 border-t border-espresso-50 px-[18px] py-[14px]">
                <Button type="button" variant="outline" className="flex-1" onClick={closeModal}>
                  Cancel
                </Button>
                <Button type="button" className="flex-1" disabled={!proposeOutcome || photoBusy} onClick={() => setStep('review')}>
                  Review the call
                </Button>
              </div>
            </>
          ) : (
            <>
              <div className="flex flex-col gap-3.5 p-[18px]">
                <div>
                  <p className="font-display text-[19px] font-extrabold tracking-[-0.01em] text-espresso-900">
                    Confirm what you're calling
                  </p>
                  <p className="mt-1 text-[13.5px] leading-[1.45] text-espresso-500">{market.title}</p>
                </div>

                {/* The call restated as the same outlined ticket the market page uses for "the
                    thing you're deciding about", stock shell and all — reusing that exact outline
                    is the whole point, so what you confirm looks like what the group will read. */}
                <TicketCard label="You're calling it" meta={kindLabel} bodyClassName="flex flex-col gap-2.5">
                  <p className="font-display text-[30px] leading-none font-extrabold tracking-[-0.02em] text-espresso-950">
                    <OptionLabel label={chosenLabel} />
                  </p>
                  {justification && (
                    <p className="border-l-2 border-espresso-100 pl-2.5 text-[13.5px] leading-[1.45] text-espresso-600">
                      {justification}
                    </p>
                  )}
                  {photoPreview && <img src={photoPreview} alt="Proof preview" className="h-14 w-14 rounded-[10px] object-cover" />}
                </TicketCard>

                {error && <p className="text-sm text-danger-700">{error}</p>}

                <div>
                  <p className="mb-2 text-[11.5px] font-extrabold tracking-[0.08em] text-espresso-400 uppercase">What this does</p>
                  <div className="flex flex-col gap-2">
                    <ConsequenceRow dotClassName="bg-danger-500">
                      {market.status === 'open' ? (
                        <>
                          Betting is still open, so this <strong className="font-bold text-danger-700">locks it for everyone right now</strong>.
                        </>
                      ) : (
                        <>Betting is already closed, so nothing changes for bettors.</>
                      )}
                    </ConsequenceRow>
                    <ConsequenceRow dotClassName="bg-espresso-800">
                      The group gets <strong className="font-bold text-espresso-900">{windowLabel} to challenge</strong> your call.
                    </ConsequenceRow>
                    <ConsequenceRow dotClassName="bg-espresso-200">
                      No challenge and it's final: the pool pays out and the ticket unseals.
                    </ConsequenceRow>
                  </div>
                </div>
              </div>

              <div className="flex gap-2 border-t border-espresso-50 px-[18px] py-[14px]">
                <Button type="button" variant="outline" className="flex-1" disabled={isPending} onClick={() => setStep('choose')}>
                  Back
                </Button>
                <Button type="button" className="flex-1 truncate" disabled={isPending} onClick={submit}>
                  Confirm {chosenLabel}
                </Button>
              </div>
            </>
          )}
        </Modal>
      )}
    </>
  );
}

/** One selectable outcome in step 1. Selection is carried by the filled honey radio *and* the
 * row's own border/background, so it survives a glance rather than needing a second look. */
function OutcomeRow({
  selected,
  onClick,
  dashed,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  dashed?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-3 rounded-[14px] border-[1.5px] px-3.5 transition-colors',
        dashed ? 'border-dashed py-[11px]' : 'py-[13px]',
        selected
          ? 'border-honey-500 bg-honey-50 text-espresso-900'
          : `bg-paper-white text-espresso-600 ${dashed ? 'border-espresso-200' : 'border-espresso-100'}`
      )}
    >
      <span
        className={cn(
          'flex h-5 w-5 shrink-0 items-center justify-center rounded-full',
          selected ? 'bg-honey-500' : 'border-[1.5px] border-espresso-200'
        )}
      >
        {selected && <CheckIcon className="h-[13px] w-[13px] text-espresso-950" />}
      </span>
      {children}
    </button>
  );
}

/** A single ranked consequence on step 2. The dot's colour is the ranking: red for the thing
 * that happens to other people immediately, dark for the window, faint for the eventual end. */
function ConsequenceRow({ dotClassName, children }: { dotClassName: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2.5">
      <span className={cn('mt-[5px] h-[7px] w-[7px] shrink-0 rounded-full', dotClassName)} />
      <p className="text-[13.5px] leading-[1.4] text-espresso-700">{children}</p>
    </div>
  );
}
