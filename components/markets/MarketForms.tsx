'use client';

import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createMarket } from '@/lib/actions/markets';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Modal } from '@/components/ui/Modal';
import { SubjectPicker, type MemberOption } from '@/components/markets/SubjectPicker';
import { OptionLabel } from '@/components/markets/OptionLabel';
import { TimezoneCaption } from '@/components/ui/TimezoneCaption';
import { Mention } from '@/components/ui/Mention';
import { InfoIcon } from '@/components/ui/icons';
import { MARKET_TYPE_ICON, MARKET_TYPE_LABEL, MARKET_TYPE_DESCRIPTION } from '@/lib/marketType';
import {
  OVER_UNDER_UNIT_PRESETS,
  OVER_UNDER_CURRENCY_ALTERNATES,
  OVER_UNDER_UNIT_MAX_LENGTH,
  formatLine,
  parseLineInput,
  type LineFormat,
} from '@/lib/units';
import { MARKET_TITLE_MAX_LENGTH, MARKET_TITLE_COUNTER_THRESHOLD } from '@/lib/limits';

const inputClasses =
  'w-full rounded-xl border border-espresso-200 bg-paper-white px-4 py-2.5 text-espresso-900 placeholder:text-espresso-300 focus:border-honey-500 focus:outline-none focus:ring-2 focus:ring-honey-200';

/** datetime-local wants "YYYY-MM-DDTHH:mm" in the browser's local time, not UTC. */
function toLocalDatetimeInputValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

interface OptionDraft {
  key: string;
  label: string;
}

let optionKeySeq = 0;
function newOption(label = ''): OptionDraft {
  optionKeySeq += 1;
  return { key: `opt-${optionKeySeq}`, label };
}

/** One option row: a single field, either plain text or a leading @mention. Typing "@" shows a nickname autocomplete; picking a suggestion fills in the exact "@nickname". */
function OptionRow({
  index,
  option,
  members,
  removable,
  onChange,
  onRemove,
}: {
  index: number;
  option: OptionDraft;
  members: MemberOption[];
  removable: boolean;
  onChange: (label: string) => void;
  onRemove: () => void;
}) {
  const [focused, setFocused] = useState(false);
  const suggestions = useMemo(() => {
    if (!focused || !option.label.startsWith('@')) return [];
    const q = option.label.slice(1).toLowerCase();
    return members.filter((m) => m.nickname.toLowerCase().includes(q)).slice(0, 6);
  }, [focused, option.label, members]);

  const isMention = option.label.startsWith('@');

  return (
    <div className="flex items-center gap-2.5">
      <span className="w-5 shrink-0 text-center text-sm font-semibold text-espresso-400">{index + 1}</span>
      <div className="relative flex-1">
        <input
          value={option.label}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 150)}
          placeholder={`Option ${index + 1}, or @nickname`}
          className={`w-full rounded-xl border px-4 py-2.5 text-[15px] placeholder:text-espresso-300 focus:outline-none focus:ring-2 ${
            isMention
              ? 'border-honey-400 bg-paper-white italic font-semibold text-honey-700 focus:border-honey-500 focus:ring-honey-200'
              : 'border-espresso-200 bg-paper-white text-espresso-900 focus:border-honey-500 focus:ring-honey-200'
          }`}
        />
        {suggestions.length > 0 && (
          <ul className="absolute z-10 mt-1 w-full overflow-hidden rounded-xl border border-espresso-100 bg-paper-white shadow-lg">
            {suggestions.map((m) => (
              <li key={m.userId}>
                <button
                  type="button"
                  onClick={() => onChange(`@${m.nickname}`)}
                  className="block w-full px-4 py-2 text-left text-sm text-espresso-800 hover:bg-honey-50"
                >
                  <Mention nickname={m.nickname} className="text-honey-700" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {removable && (
        <button
          type="button"
          onClick={onRemove}
          aria-label="Remove option"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-lg text-espresso-400 hover:bg-espresso-50 hover:text-danger-700"
        >
          ×
        </button>
      )}
    </div>
  );
}

function MultipleChoiceOptionsEditor({
  members,
  options,
  setOptions,
}: {
  members: MemberOption[];
  options: OptionDraft[];
  setOptions: (next: OptionDraft[]) => void;
}) {
  function updateOption(key: string, label: string) {
    setOptions(options.map((o) => (o.key === key ? { ...o, label } : o)));
  }

  function removeOption(key: string) {
    setOptions(options.filter((o) => o.key !== key));
  }

  return (
    <div className="space-y-3">
      {options.map((option, i) => (
        <OptionRow
          key={option.key}
          index={i}
          option={option}
          members={members}
          removable={options.length > 2}
          onChange={(label) => updateOption(option.key, label)}
          onRemove={() => removeOption(option.key)}
        />
      ))}

      {options.length < 10 && (
        <button
          type="button"
          onClick={() => setOptions([...options, newOption()])}
          className="w-full rounded-xl border border-dashed border-espresso-200 py-2.5 text-sm font-semibold text-espresso-500 hover:border-honey-400 hover:text-honey-700"
        >
          + Add option
        </button>
      )}

      <p className="text-xs text-espresso-400">
        Each field is an option. Write whatever you want or type @ and pick a member to make the option about them.
        Mentioning someone hides the whole market from them until it resolves.
      </p>
    </div>
  );
}

export function CreateMarketForm({
  groupId,
  members,
  totalMemberCount,
  timezone,
  requireEndorsement,
  initialMarketType,
}: {
  groupId: string;
  members: MemberOption[];
  totalMemberCount: number;
  timezone: string;
  requireEndorsement: boolean;
  /** Pre-selects the type step — set when arriving from BottomNav's create-market sheet, which
   * already asked "how should it settle?" before handing off here. Still just the initial value;
   * the picker below stays fully changeable. */
  initialMarketType?: 'yes_no' | 'over_under' | 'multiple_choice';
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [marketType, setMarketType] = useState<'yes_no' | 'over_under' | 'multiple_choice'>(initialMarketType ?? 'yes_no');
  const [subjects, setSubjects] = useState<MemberOption[]>([]);
  const [titleLength, setTitleLength] = useState(0);
  const [options, setOptions] = useState<OptionDraft[]>(() => [newOption(), newOption()]);
  const [unit, setUnit] = useState('');
  const [otherUnit, setOtherUnit] = useState(false);
  const [lineFormat, setLineFormat] = useState<LineFormat>('number');
  const [showCurrencyAlternates, setShowCurrencyAlternates] = useState(false);
  const currencyPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function startCurrencyPress() {
    currencyPressTimer.current = setTimeout(() => setShowCurrencyAlternates(true), 450);
  }
  function endCurrencyPress() {
    if (currencyPressTimer.current) {
      clearTimeout(currencyPressTimer.current);
      currencyPressTimer.current = null;
    }
  }
  const [minCloseTime] = useState(() => toLocalDatetimeInputValue(new Date(Date.now() + 60_000)));
  const [defaultCloseTime] = useState(() => toLocalDatetimeInputValue(new Date(Date.now() + 60 * 60_000)));
  const [pendingFormData, setPendingFormData] = useState<FormData | null>(null);

  // A multiple choice market can only be "about" someone one way at a time: an
  // @mentioned option, or this general About field, never both. Once an option
  // names its own subject, any general subjects picked earlier no longer apply.
  const hasOptionSubject = marketType === 'multiple_choice' && options.some((o) => o.label.trim().startsWith('@'));
  useEffect(() => {
    if (hasOptionSubject) setSubjects([]);
  }, [hasOptionSubject]);

  function submitMarket(formData: FormData) {
    const closesAtLocal = String(formData.get('closesAt'));
    startTransition(async () => {
      const result = await createMarket({
        groupId,
        title: String(formData.get('title')),
        description: String(formData.get('description')),
        marketType,
        closesAt: new Date(closesAtLocal).toISOString(),
        line: marketType === 'over_under' ? parseLineInput(String(formData.get('line')), lineFormat) : null,
        unit: marketType === 'over_under' ? (lineFormat === 'number' ? unit.trim() || null : lineFormat) : null,
        subjectUserIds: hasOptionSubject ? [] : subjects.map((s) => s.userId),
        options: marketType === 'multiple_choice' ? options.map((o) => o.label.trim()) : undefined,
      });
      if (result.error) {
        setError(result.error);
      } else {
        router.push(`/groups/${groupId}/markets/${result.data!.id}`);
      }
    });
  }

  function handleCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const formData = new FormData(e.currentTarget);

    if (marketType === 'multiple_choice') {
      const trimmed = options.map((o) => o.label.trim());
      if (trimmed.some((l) => l === '')) {
        setError('Every option needs a label.');
        return;
      }
      if (new Set(trimmed).size !== trimmed.length) {
        setError('Option labels must be unique.');
        return;
      }
    }

    setPendingFormData(formData);
  }

  return (
    <form onSubmit={handleCreate} className="space-y-5">
      {error && <p className="text-sm text-danger-700">{error}</p>}

      <div className="space-y-1.5">
        <label className="block text-sm font-semibold text-espresso-700">Market type</label>
        <div className="flex gap-1 rounded-xl bg-espresso-50 p-1">
          {(['yes_no', 'over_under', 'multiple_choice'] as const).map((t) => (
            <button
              type="button"
              key={t}
              onClick={() => setMarketType(t)}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-semibold transition-colors ${
                marketType === t ? 'bg-paper-white text-espresso-900 shadow-sm' : 'text-espresso-400 hover:text-espresso-600'
              }`}
            >
              <span aria-hidden className="text-sm">
                {MARKET_TYPE_ICON[t]}
              </span>
              {MARKET_TYPE_LABEL[t]}
            </button>
          ))}
        </div>
        <p className="text-xs text-espresso-400">{MARKET_TYPE_DESCRIPTION[marketType]}</p>
      </div>

      <Card className="space-y-3">
        <div className="space-y-1.5">
          <div className="flex items-baseline justify-between gap-2">
            <label className="block text-sm font-semibold text-espresso-700">Market title</label>
            {titleLength >= MARKET_TITLE_COUNTER_THRESHOLD && (
              <span className={`text-xs ${titleLength >= MARKET_TITLE_MAX_LENGTH ? 'text-danger-700' : 'text-espresso-400'}`}>
                {titleLength}/{MARKET_TITLE_MAX_LENGTH}
              </span>
            )}
          </div>
          <textarea
            name="title"
            maxLength={MARKET_TITLE_MAX_LENGTH}
            placeholder={
              marketType === 'multiple_choice'
                ? "Who's first to leave the party?"
                : marketType === 'over_under'
                  ? 'How many drinks will Jake have tonight?'
                  : 'Will Jake finish the marathon?'
            }
            required
            rows={2}
            onInput={(e) => {
              const el = e.currentTarget;
              el.style.height = 'auto';
              el.style.height = `${el.scrollHeight}px`;
              setTitleLength(el.value.length);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.preventDefault();
            }}
            className={`${inputClasses} min-h-[4.5rem] resize-none overflow-hidden`}
          />
        </div>

        <div className="space-y-1.5">
          <label className="block text-sm font-semibold text-espresso-700">Resolution criteria</label>
          <p className="text-xs text-espresso-400">
            Keep the title short. Save the specifics of what counts as a win, and how it'll be judged, for here.
          </p>
          <textarea
            name="description"
            placeholder="Be specific about what counts, e.g. the exact source or measurement used."
            required
            rows={3}
            className={inputClasses}
          />
        </div>

        {marketType === 'over_under' && (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <label className="block text-sm font-semibold text-espresso-700">The line</label>
              <div className="flex flex-wrap gap-2">
                {(['number', 'date', 'time'] as const).map((f) => (
                  <button
                    type="button"
                    key={f}
                    onClick={() => setLineFormat(f)}
                    className={`rounded-full border px-3 py-1 text-sm font-semibold capitalize ${
                      lineFormat === f ? 'border-honey-500 bg-honey-50 text-honey-800' : 'border-espresso-200 text-espresso-600'
                    }`}
                  >
                    {f}
                  </button>
                ))}
              </div>

              {lineFormat === 'number' ? (
                <input
                  name="line"
                  type="number"
                  step="0.5"
                  placeholder="5.5 (use a half to avoid a push)"
                  required
                  className={inputClasses}
                />
              ) : (
                <input name="line" type={lineFormat === 'date' ? 'date' : 'time'} required className={inputClasses} />
              )}
            </div>

            {lineFormat === 'number' && (
              <div className="space-y-1.5">
                <label className="block text-sm font-semibold text-espresso-700">Unit (optional)</label>
                <div className="flex flex-wrap gap-2">
                  {OVER_UNDER_UNIT_PRESETS.map((preset) => (
                    <button
                      type="button"
                      key={preset}
                      onPointerDown={preset === '$' ? startCurrencyPress : undefined}
                      onPointerUp={preset === '$' ? endCurrencyPress : undefined}
                      onPointerLeave={preset === '$' ? endCurrencyPress : undefined}
                      onClick={() => {
                        setUnit(preset);
                        setOtherUnit(false);
                      }}
                      className={`rounded-full border px-3 py-1 text-sm font-semibold ${
                        unit === preset && !otherUnit
                          ? 'border-honey-500 bg-honey-50 text-honey-800'
                          : 'border-espresso-200 text-espresso-600'
                      }`}
                    >
                      {preset}
                    </button>
                  ))}
                  {showCurrencyAlternates &&
                    OVER_UNDER_CURRENCY_ALTERNATES.map((alt) => (
                      <button
                        type="button"
                        key={alt}
                        onClick={() => {
                          setUnit(alt);
                          setOtherUnit(false);
                        }}
                        className={`rounded-full border px-3 py-1 text-sm font-semibold ${
                          unit === alt && !otherUnit
                            ? 'border-honey-500 bg-honey-50 text-honey-800'
                            : 'border-espresso-200 text-espresso-600'
                        }`}
                      >
                        {alt}
                      </button>
                    ))}
                  <button
                    type="button"
                    onClick={() => {
                      setOtherUnit(true);
                      setUnit('');
                    }}
                    className={`rounded-full border px-3 py-1 text-sm font-semibold ${
                      otherUnit ? 'border-honey-500 bg-honey-50 text-honey-800' : 'border-espresso-200 text-espresso-600'
                    }`}
                  >
                    Custom
                  </button>
                </div>
                {/* The custom field lives here under the presets it replaces, not beside the line
                    input where it used to sit: it is one more way of answering "what unit?", so
                    it belongs with the other answers. Its own cancel gets you back to the presets
                    without having to guess that re-tapping Custom would do it. */}
                {otherUnit && (
                  <div className="flex items-center gap-2">
                    <input
                      autoFocus
                      value={unit}
                      onChange={(e) => setUnit(e.target.value)}
                      maxLength={OVER_UNDER_UNIT_MAX_LENGTH}
                      placeholder="e.g. laps, pints, minutes"
                      className={`${inputClasses} min-w-0 flex-1`}
                    />
                    <button
                      type="button"
                      onClick={() => {
                        setOtherUnit(false);
                        setUnit('');
                      }}
                      aria-label="Cancel custom unit"
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-lg text-espresso-400 hover:bg-espresso-50 hover:text-danger-700"
                    >
                      ×
                    </button>
                  </div>
                )}
                {!showCurrencyAlternates && !otherUnit && <p className="text-xs text-espresso-400">Hold $ for other currencies.</p>}
              </div>
            )}
          </div>
        )}

        <div className="space-y-1.5">
          <label className="text-sm font-semibold text-espresso-600">Betting closes</label>
          <p className="text-xs text-espresso-400">
            Set this to the earliest reasonable time the outcome could actually be known, not a generous buffer, so
            bets stay live as long as possible.
          </p>
          <input
            name="closesAt"
            type="datetime-local"
            min={minCloseTime}
            defaultValue={defaultCloseTime}
            required
            className={inputClasses}
          />
          <TimezoneCaption groupTimezone={timezone} />
        </div>
      </Card>

      {marketType === 'multiple_choice' ? (
        <>
          <Card>
            <h3 className="mb-2 font-semibold text-espresso-800">Options</h3>
            <MultipleChoiceOptionsEditor members={members} options={options} setOptions={setOptions} />
          </Card>
          {!hasOptionSubject && (
            <Card>
              <h3 className="mb-2 font-semibold text-espresso-800">About (optional)</h3>
              <p className="mb-2 text-xs text-espresso-400">
                None of your options name a member, but this market can still be hidden from someone.
              </p>
              <SubjectPicker members={members} selected={subjects} onChange={setSubjects} totalMemberCount={totalMemberCount} />
            </Card>
          )}
        </>
      ) : (
        <Card>
          <h3 className="mb-2 font-semibold text-espresso-800">About (optional)</h3>
          <SubjectPicker members={members} selected={subjects} onChange={setSubjects} totalMemberCount={totalMemberCount} />
        </Card>
      )}

      <Button type="submit" disabled={isPending} className="w-full" size="lg">
        {isPending ? 'Creating…' : 'Create market'}
      </Button>

      {pendingFormData && (
        <ReviewMarketModal
          formData={pendingFormData}
          marketType={marketType}
          subjects={subjects}
          options={options}
          unit={unit}
          lineFormat={lineFormat}
          timezone={timezone}
          requireEndorsement={requireEndorsement}
          onEdit={() => setPendingFormData(null)}
          onConfirm={() => {
            const formData = pendingFormData;
            setPendingFormData(null);
            submitMarket(formData);
          }}
        />
      )}
    </form>
  );
}

/** One divided field row in the review ticket. Rows are separated rather than stacked so a long
 * criteria paragraph can't visually merge with the close time under it. */
function ReviewRow({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`border-t border-espresso-50 px-[18px] py-[13px] ${className ?? ''}`}>
      <p className="text-[10.5px] font-extrabold tracking-[0.1em] text-espresso-400 uppercase">{label}</p>
      {children}
    </div>
  );
}

/**
 * The last check before `createMarket`, shaped as the ticket the market is about to become: the
 * same outlined shell, header band and title treatment the group will see on the market page, so
 * what you confirm resembles what you're publishing rather than a form summary of it.
 *
 * The endorsement rule lives here too. It used to be small print under the submit button, where
 * it explained a consequence of an action nobody had taken yet; on the confirmation step it is
 * the last thing read before the market exists.
 */
function ReviewMarketModal({
  formData,
  marketType,
  subjects,
  options,
  unit,
  lineFormat,
  timezone,
  requireEndorsement,
  onEdit,
  onConfirm,
}: {
  formData: FormData;
  marketType: 'yes_no' | 'over_under' | 'multiple_choice';
  subjects: MemberOption[];
  options: OptionDraft[];
  unit: string;
  lineFormat: LineFormat;
  timezone: string;
  requireEndorsement: boolean;
  onEdit: () => void;
  onConfirm: () => void;
}) {
  const title = String(formData.get('title'));
  const description = String(formData.get('description'));
  const closesAtLocal = String(formData.get('closesAt'));
  const closesAtDate = new Date(closesAtLocal);
  const line = marketType === 'over_under' ? parseLineInput(String(formData.get('line')), lineFormat) : null;
  const displayUnit = lineFormat === 'number' ? unit.trim() || null : lineFormat;
  const lineIsWholeNumber = lineFormat === 'number' && line !== null && Number.isInteger(line);

  const kindLabel =
    marketType === 'yes_no' ? 'Yes / No' : marketType === 'over_under' ? 'Over / Under' : `One of ${options.length} options`;

  const subjectChips = subjects.map((s) => (
    <span key={s.userId} className="inline-flex items-center rounded-full bg-espresso-50 px-[11px] py-[5px] text-[13px] font-semibold">
      <Mention nickname={s.nickname} />
    </span>
  ));

  return (
    <Modal
      onClose={onEdit}
      padded={false}
      panelClassName="max-h-[85dvh] overflow-x-hidden overflow-y-auto border-[1.5px] border-espresso-800"
    >
      <div className="flex items-center justify-between gap-3 bg-espresso-50 px-[18px] py-[11px]">
        <p className="text-xs font-extrabold tracking-[0.06em] text-espresso-800 uppercase">Review your market</p>
        <p className="shrink-0 text-xs font-semibold text-espresso-500">{kindLabel}</p>
      </div>

      <div className="px-[18px] pt-4 pb-1">
        <p className="font-display text-[21px] leading-[1.2] font-extrabold tracking-[-0.01em] text-espresso-950 text-pretty">
          {title}
        </p>
      </div>

      <ReviewRow label="How it settles">
        <p className="mt-1 text-sm leading-[1.45] text-espresso-700 text-pretty">{description}</p>
      </ReviewRow>

      {marketType === 'over_under' && (
        <ReviewRow label="The line">
          <p className="mt-1 text-[15px] font-extrabold text-espresso-950">{formatLine(line, displayUnit)}</p>
          {lineIsWholeNumber && (
            <p className="mt-1.5 rounded-lg bg-honey-50 px-2.5 py-1.5 text-xs text-honey-800">
              A whole number can land on an exact tie, which the group would have to resolve as VOID. A half (like 3.5)
              avoids that entirely.
            </p>
          )}
        </ReviewRow>
      )}

      <ReviewRow label="Betting closes">
        <p className="mt-1 text-[15px] font-extrabold text-espresso-950">
          {closesAtDate.toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
        </p>
        <TimezoneCaption groupTimezone={timezone} />
      </ReviewRow>

      {marketType === 'multiple_choice' && (
        <ReviewRow label="Options">
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {options.map((o) => (
              <span
                key={o.key}
                className="inline-flex items-center rounded-full bg-espresso-50 px-[11px] py-[5px] text-[13px] font-semibold text-espresso-800"
              >
                <OptionLabel label={o.label.trim()} />
              </span>
            ))}
          </div>
        </ReviewRow>
      )}

      <ReviewRow label="Hidden from">
        {subjects.length === 0 ? (
          <p className="mt-1 text-sm text-espresso-700">Nobody, this market is not about anyone in particular.</p>
        ) : (
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {subjectChips}
            <span className="text-[12.5px] text-espresso-400">won't see this market until it resolves</span>
          </div>
        )}
      </ReviewRow>

      {/* Only when endorsement is actually required. With the setting off, betting simply opens
          on create, which is what every other confirmation modal in the app already implies —
          a highlighted callout to say "nothing unusual happens next" is a rule where there
          isn't one. */}
      {requireEndorsement && (
        <div className="flex items-start gap-2.5 border-t border-espresso-50 bg-honey-50 px-[18px] py-[13px]">
          <InfoIcon className="mt-px h-[17px] w-[17px] shrink-0 text-honey-800" />
          <p className="text-[13px] leading-[1.45] text-honey-900">
            One other member has to endorse this before betting opens. If nobody does within 24 hours, it expires.
          </p>
        </div>
      )}

      <div className="flex gap-2 border-t border-espresso-100 px-[18px] py-[14px]">
        <Button type="button" variant="outline" className="shrink-0 px-[22px]" onClick={onEdit}>
          Edit
        </Button>
        <Button type="button" className="flex-1" onClick={onConfirm}>
          Create market
        </Button>
      </div>
    </Modal>
  );
}
