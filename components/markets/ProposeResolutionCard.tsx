'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Capacitor } from '@capacitor/core';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import { proposeResolution } from '@/lib/actions/resolution';
import { compressImage } from '@/lib/compressImage';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Modal } from '@/components/ui/Modal';
import { OptionLabel } from '@/components/markets/OptionLabel';
import { CameraIcon, ImageIcon, ClockIcon } from '@/components/ui/icons';
import type { Market, MarketOption } from '@/lib/actions/markets';

const inputClasses =
  'w-full rounded-xl border border-espresso-200 bg-paper-white px-4 py-2.5 text-espresso-900 focus:border-honey-500 focus:outline-none focus:ring-2 focus:ring-honey-200';

/** Its own card, deliberately set apart from the resolution-criteria card above it on the market
    page — proposing is a distinct, consequential action (locks betting immediately, or starts
    the finalize clock), not just more market metadata to skim past. One button opens a two-step
    modal, pick the answer, then review a plain-language consequence before confirming, whether
    the market is still `open` (an early close) or already `closed`; there's no separate inline
    flow for either case anymore. */
export function ProposeResolutionCard({
  groupId,
  market,
  options,
  resolutionWindowHours,
  variant = 'default',
}: {
  groupId: string;
  market: Market;
  options: MarketOption[] | null;
  resolutionWindowHours: number;
  /** 'waiting' — the market-closed screen's dashed "waiting on a result" empty state, where
   * proposing is the screen's whole job and so gets a filled button.
   * 'embedded' — bare outlined trigger, no card, divider, or copy of its own, meant to be handed
   * to ResolutionTimeline as its action. Outlined rather than filled because on an open market
   * the primary action is betting, and this must never look like it belongs where betting does.
   * Same modal underneath in every case. */
  variant?: 'default' | 'waiting' | 'embedded';
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
  const choiceLabels: { value: string; label: string }[] = isMultipleChoice
    ? [...(options ?? []).map((o) => ({ value: o.id, label: o.label })), { value: 'void', label: 'VOID' }]
    : [...sides.map((s) => ({ value: s, label: s.toUpperCase() })), { value: 'void', label: 'VOID' }];

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
      {variant === 'waiting' ? (
        <Card className="space-y-3.5 !rounded-[20px] !border !border-dashed !border-espresso-200">
          <div className="flex items-start gap-2.5">
            <span className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[11px] bg-espresso-50 text-espresso-600">
              <ClockIcon className="h-[17px] w-[17px]" />
            </span>
            <div className="flex-1 space-y-0.5">
              <p className="text-[15.5px] font-extrabold text-espresso-950">Waiting on a result</p>
              <p className="text-[13.5px] leading-[1.45] text-espresso-500">
                Nobody's said how it went yet. Anyone who knows can call it, including you.
              </p>
            </div>
          </div>
          <Button className="w-full" onClick={openModal}>
            Propose the outcome
          </Button>
        </Card>
      ) : variant === 'embedded' ? (
        <button
          type="button"
          onClick={openModal}
          className="w-full rounded-full border border-espresso-200 px-4 py-2.5 text-sm font-semibold text-espresso-600 transition-colors hover:bg-espresso-50"
        >
          Propose result early
        </button>
      ) : (
        <Card className="space-y-2">
          <p className="text-sm font-semibold text-espresso-700">Know what happened?</p>
          <p className="text-xs text-espresso-500">
            {market.status === 'open'
              ? 'Proposing now closes betting immediately for everyone, then starts the clock for a challenge.'
              : `Propose what happened and other members get ${resolutionWindowHours}h to challenge it before it's final.`}
          </p>
          <Button variant="outline" className="w-full" onClick={openModal}>
            Propose the outcome
          </Button>
        </Card>
      )}

      {modalOpen && (
        <Modal onClose={closeModal}>
          {step === 'choose' ? (
            <>
              <p className="font-display text-lg font-bold text-espresso-900">What actually happened?</p>
              {error && <p className="text-sm text-danger-700">{error}</p>}
              <div className="flex flex-wrap gap-2">
                {choiceLabels.map((c) => (
                  <button
                    key={c.value}
                    type="button"
                    onClick={() => setProposeOutcome(c.value)}
                    className={`rounded-full border px-4 py-1.5 text-sm font-semibold uppercase ${
                      proposeOutcome === c.value ? 'border-honey-500 bg-honey-50 text-honey-800' : 'border-espresso-200 text-espresso-600'
                    }`}
                  >
                    <OptionLabel label={c.label} />
                  </button>
                ))}
              </div>
              <textarea
                value={justification}
                onChange={(e) => setJustification(e.target.value)}
                placeholder="Short justification (optional, but helps everyone trust the call)"
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
                <div className="space-y-1.5">
                  <p className="text-xs text-espresso-400">Proof photo (optional)</p>
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
                </div>
              )}

              <div className="flex gap-2 pt-1">
                <Button type="button" variant="outline" className="flex-1" onClick={closeModal}>
                  Cancel
                </Button>
                <Button type="button" className="flex-1" disabled={!proposeOutcome || photoBusy} onClick={() => setStep('review')}>
                  Review
                </Button>
              </div>
            </>
          ) : (
            <>
              <p className="font-display text-lg font-bold text-espresso-900">Review your proposal</p>
              <p className="text-sm text-espresso-600">
                You're proposing <OptionLabel label={chosenLabel} /> is what actually happened, not placing a bet.
              </p>
              {justification && <p className="rounded-lg bg-espresso-50 p-2.5 text-sm text-espresso-600">{justification}</p>}
              {photoPreview && <img src={photoPreview} alt="Proof preview" className="h-16 w-16 rounded-lg object-cover" />}
              {error && <p className="text-sm text-danger-700">{error}</p>}
              <p className="text-xs font-semibold text-danger-700">
                {market.status === 'open'
                  ? 'Betting is still open, so this locks it for everyone right now. '
                  : 'Betting is already closed. '}
                Other members get {resolutionWindowHours}h to challenge it before it's final.
              </p>
              <div className="flex gap-2 pt-1">
                <Button type="button" variant="outline" className="flex-1" disabled={isPending} onClick={() => setStep('choose')}>
                  Back
                </Button>
                <Button type="button" className="flex-1" disabled={isPending} onClick={submit}>
                  Confirm
                </Button>
              </div>
            </>
          )}
        </Modal>
      )}
    </>
  );
}
