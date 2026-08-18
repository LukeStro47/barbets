'use client';

import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createMarket } from '@/lib/actions/markets';
import { OptionLabel } from '@/components/markets/OptionLabel';
import { Mention } from '@/components/ui/Mention';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { InfoIcon, CalendarIcon, CaretLeftIcon, CaretDownIcon } from '@/components/ui/icons';
import { MARKET_TYPE_LABEL, type MarketType } from '@/lib/marketType';
import {
  OVER_UNDER_UNIT_PRESETS,
  OVER_UNDER_CURRENCY_ALTERNATES,
  OVER_UNDER_UNIT_MAX_LENGTH,
  formatLine,
  parseLineInput,
  isPrefixedUnit,
  type LineFormat,
} from '@/lib/units';
import { friendlyTimezoneName } from '@/lib/timezone';
import { MARKET_TITLE_MAX_LENGTH, MARKET_TITLE_COUNTER_THRESHOLD, OPTION_LABEL_MAX_LENGTH } from '@/lib/limits';
import { cn } from '@/lib/cn';

const cardClasses = 'rounded-[18px] border border-espresso-100 bg-paper-white p-4';
const focusCardClasses = 'rounded-[18px] border-[1.5px] border-honey-500 bg-paper-white p-4';
const headingClasses = 'font-display text-[30px] leading-[1.08] font-extrabold tracking-[-0.025em] text-espresso-950';
const footerButtonClasses =
  'flex h-[52px] w-full items-center justify-center rounded-full border-0 bg-espresso-800 text-[15px] font-extrabold text-paper-white disabled:opacity-45';
const eyebrowClasses = 'text-[10.5px] font-extrabold tracking-[0.1em] text-espresso-400 uppercase';

const pad = (n: number) => String(n).padStart(2, '0');

/** datetime-local wants "YYYY-MM-DDTHH:mm" in the browser's local time, not UTC. */
function toLocalDatetimeInputValue(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** `<input type="date">` wants "YYYY-MM-DD", also in local time. */
function toLocalDateInputValue(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Switching the line to a date or a time lands on a plausible answer rather than an empty field:
 * a week out, or midday. Both are far more often the right ballpark than "now" would be, and an
 * empty date input is the one control people reliably walk past without filling in. */
function defaultLineFor(format: LineFormat): string {
  if (format === 'date') return toLocalDateInputValue(new Date(Date.now() + 7 * 24 * 60 * 60_000));
  if (format === 'time') return '12:00';
  return '';
}

/** One member as the create-market form needs them: enough to render an @mention chip and to send
 * a subject id. Lived in SubjectPicker until the typeahead it belonged to was replaced by the
 * chip strip below. */
export interface MemberOption {
  userId: string;
  nickname: string;
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

function StepBar({
  step,
  label,
  backLabel,
  onBack,
}: {
  step: 1 | 2 | 3;
  label: string;
  /** Named only on the step where "back" means leaving the flow; deeper in, the caret alone is unambiguous. */
  backLabel?: string;
  onBack: () => void;
}) {
  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={onBack}
        aria-label={backLabel ?? 'Back'}
        className="-ml-1.5 inline-flex shrink-0 items-center gap-0.5 border-0 bg-transparent p-0 text-espresso-300"
      >
        <CaretLeftIcon className="h-[18px] w-[18px]" />
        {backLabel && <span className="text-[12.5px] font-bold text-espresso-400">{backLabel}</span>}
      </button>
      <span className="flex flex-1 gap-[5px]">
        {[1, 2, 3].map((i) => (
          <span key={i} className={cn('h-1 flex-1 rounded-full', i <= step ? 'bg-honey-500' : 'bg-espresso-100')} />
        ))}
      </span>
      <span className="text-[11px] font-extrabold tracking-[0.06em] text-espresso-400 uppercase">{label}</span>
    </div>
  );
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
          maxLength={OPTION_LABEL_MAX_LENGTH}
          className={cn(
            'w-full rounded-xl border px-3.5 py-2.5 text-[15px] placeholder:text-espresso-300 focus:outline-none',
            isMention
              ? 'border-honey-400 bg-paper-white font-semibold text-honey-700 italic focus:border-honey-500'
              : 'border-espresso-200 bg-paper-white text-espresso-900 focus:border-honey-500'
          )}
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

/** The chip strip that replaced the typeahead: a group small enough to bet in is a group small
 * enough to list, and "who is this about?" is a question you answer by recognising a name rather
 * than by recalling one. "Nobody" is a real chip rather than the absence of a choice, so the
 * unanswered and the deliberately-nobody cases stop looking identical. */
const SUBJECT_PAGE_SIZE = 20;

function SubjectChips({
  members,
  selected,
  onChange,
  maxSubjects,
}: {
  members: MemberOption[];
  selected: MemberOption[];
  onChange: (next: MemberOption[]) => void;
  maxSubjects: number;
}) {
  const [visibleCount, setVisibleCount] = useState(SUBJECT_PAGE_SIZE);
  const atCap = selected.length >= maxSubjects;
  const nobody = selected.length === 0;

  // A big group would otherwise put a hundred chips between the question and the footer. Anyone
  // already picked stays on screen regardless of which page they fall on — paging away someone's
  // own choice would read as having lost it.
  const isSelected = (m: MemberOption) => selected.some((s) => s.userId === m.userId);
  const shown = [...members.slice(0, visibleCount), ...members.slice(visibleCount).filter(isSelected)];
  const remaining = members.length - visibleCount;

  return (
    <>
      <div className="mt-2.5 flex flex-wrap gap-[7px]">
        {shown.map((m) => {
          const on = isSelected(m);
          return (
            <button
              key={m.userId}
              type="button"
              disabled={!on && atCap}
              onClick={() => onChange(on ? selected.filter((s) => s.userId !== m.userId) : [...selected, m])}
              className={cn(
                'rounded-full px-3.5 py-2 text-[13px] disabled:opacity-40',
                on
                  ? 'border-[1.5px] border-honey-500 bg-honey-50 font-extrabold text-honey-800'
                  : 'border border-espresso-200 bg-transparent font-bold text-espresso-600'
              )}
            >
              <Mention nickname={m.nickname} />
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => onChange([])}
          className={cn(
            'rounded-full px-3.5 py-2 text-[13px]',
            nobody
              ? 'border-[1.5px] border-honey-500 bg-honey-50 font-extrabold text-honey-800'
              : 'border border-espresso-200 bg-transparent font-bold text-espresso-600'
          )}
        >
          Nobody
        </button>
      </div>

      {remaining > 0 && (
        <button
          type="button"
          onClick={() => setVisibleCount((c) => c + SUBJECT_PAGE_SIZE)}
          className="mt-2.5 border-0 bg-transparent p-0 text-[12.5px] font-extrabold text-honey-700"
        >
          Show {Math.min(remaining, SUBJECT_PAGE_SIZE)} more
        </button>
      )}
      {remaining <= 0 && members.length > SUBJECT_PAGE_SIZE && (
        <button
          type="button"
          onClick={() => setVisibleCount(SUBJECT_PAGE_SIZE)}
          className="mt-2.5 border-0 bg-transparent p-0 text-[12.5px] font-extrabold text-honey-700"
        >
          Show fewer
        </button>
      )}
    </>
  );
}

export function CreateMarketForm({
  groupId,
  groupName,
  members,
  totalMemberCount,
  timezone,
  requireEndorsement,
  initialMarketType,
}: {
  groupId: string;
  groupName: string;
  members: MemberOption[];
  totalMemberCount: number;
  timezone: string;
  requireEndorsement: boolean;
  /** The market type, chosen in BottomNav's create sheet before this page opened — the reason
   * there's no type picker here any more. Falls back to a yes/no market for anyone who reaches
   * the route directly without one. */
  initialMarketType?: MarketType;
}) {
  const router = useRouter();
  const marketType: MarketType = initialMarketType ?? 'yes_no';

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [line, setLine] = useState('');
  const [unit, setUnit] = useState('');
  const [lineFormat, setLineFormat] = useState<LineFormat>('number');
  const [unitPickerOpen, setUnitPickerOpen] = useState(false);
  const [customUnit, setCustomUnit] = useState(false);
  const [showCurrencyAlternates, setShowCurrencyAlternates] = useState(false);
  const currencyPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [subjects, setSubjects] = useState<MemberOption[]>([]);
  const [options, setOptions] = useState<OptionDraft[]>(() => [newOption(), newOption()]);
  const [minCloseTime] = useState(() => toLocalDatetimeInputValue(new Date(Date.now() + 60_000)));
  const [closesAt, setClosesAt] = useState(() => toLocalDatetimeInputValue(new Date(Date.now() + 60 * 60_000)));

  function startCurrencyPress() {
    currencyPressTimer.current = setTimeout(() => setShowCurrencyAlternates(true), 450);
  }
  function endCurrencyPress() {
    if (currencyPressTimer.current) {
      clearTimeout(currencyPressTimer.current);
      currencyPressTimer.current = null;
    }
  }

  // A multiple choice market can only be "about" someone one way at a time: an @mentioned option,
  // or the About chips, never both. Once an option names its own subject, any subjects picked
  // earlier no longer apply.
  const hasOptionSubject = marketType === 'multiple_choice' && options.some((o) => o.label.trim().startsWith('@'));
  useEffect(() => {
    if (hasOptionSubject) setSubjects([]);
  }, [hasOptionSubject]);

  // Each step is its own screenful, so arriving at one part-scrolled hides the step bar that says
  // where you are. Same reset the create-group wizard does on every step change.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [step]);

  const isOverUnder = marketType === 'over_under';
  const displayUnit = lineFormat === 'number' ? unit.trim() || null : lineFormat;
  const parsedLine = isOverUnder && line !== '' ? parseLineInput(line, lineFormat) : null;
  const closesAtDate = new Date(closesAt);

  function goToStep2() {
    setError(null);
    if (!title.trim()) return setError('Every market needs a question.');
    if (isOverUnder && line === '') return setError('Set the line this market is bet against.');
    if (marketType === 'multiple_choice') {
      const trimmed = options.map((o) => o.label.trim());
      if (trimmed.some((l) => l === '')) return setError('Every option needs a label.');
      if (new Set(trimmed).size !== trimmed.length) return setError('Option labels must be unique.');
    }
    setStep(2);
  }

  function goToStep3() {
    setError(null);
    if (!description.trim()) return setError('Say what counts as a win.');
    if (!closesAt) return setError('Set when betting closes.');
    setStep(3);
  }

  function submitMarket() {
    setError(null);
    startTransition(async () => {
      const result = await createMarket({
        groupId,
        title: title.trim(),
        description: description.trim(),
        marketType,
        closesAt: new Date(closesAt).toISOString(),
        line: isOverUnder ? parseLineInput(line, lineFormat) : null,
        unit: isOverUnder ? displayUnit : null,
        subjectUserIds: hasOptionSubject ? [] : subjects.map((s) => s.userId),
        options: marketType === 'multiple_choice' ? options.map((o) => o.label.trim()) : undefined,
      });
      if (result.error) {
        // Stays on the review step: the alert says what's wrong over the ticket it's about, and
        // throwing someone back to step 1 to read it would lose their place for no reason.
        setError(result.error);
      } else {
        router.push(`/groups/${groupId}/markets/${result.data!.id}`);
      }
    });
  }

  /** Switching what the line *is* resets what it says, but only on a real change — retyping a
   * number just because the unit next to it changed would be maddening. */
  function chooseFormat(next: LineFormat) {
    if (next !== lineFormat) setLine(defaultLineFor(next));
    setLineFormat(next);
  }

  const hasUnit = lineFormat !== 'number' || !!unit.trim();
  const unitButton = (
    <button
      type="button"
      onClick={() => setUnitPickerOpen((v) => !v)}
      aria-expanded={unitPickerOpen}
      className={cn(
        'flex shrink-0 items-center gap-1.5 rounded-[14px] border-[1.5px] px-3.5 py-3 text-sm font-extrabold',
        hasUnit ? 'border-espresso-200 bg-espresso-50 text-espresso-700' : 'border-dashed border-espresso-200 bg-transparent text-espresso-500'
      )}
    >
      {lineFormat === 'date' ? 'A date' : lineFormat === 'time' ? 'A time' : unit.trim() || 'Add unit'}
      <CaretDownIcon className={cn('h-3.5 w-3.5 text-espresso-400 transition-transform', unitPickerOpen && 'rotate-180')} />
    </button>
  );

  /** A blocked step is an interruption, so it interrupts. The same message as a red line above the
   * heading was reliably missed: it sits at the top of a screen whose action is pinned to the
   * bottom, which is exactly where you are looking when you press Next. */
  const errorAlert = error && (
    <Modal onClose={() => setError(null)}>
      <p className="font-display font-bold text-espresso-900">Not quite there</p>
      <p className="text-sm leading-[1.5] text-espresso-600">{error}</p>
      <Button className="w-full" onClick={() => setError(null)}>
        Got it
      </Button>
    </Modal>
  );

  if (step === 1) {
    return (
      <div className="flex flex-1 flex-col gap-[18px]">
        <StepBar step={1} label="Ask" backLabel="All markets" onBack={() => router.push(`/groups/${groupId}`)} />
        {errorAlert}

        <div>
          <p className="text-[11px] font-extrabold tracking-[0.1em] text-honey-700 uppercase">
            {MARKET_TYPE_LABEL[marketType]} · {groupName}
          </p>
          <h1 className={cn(headingClasses, 'mt-2')}>What&apos;s the question?</h1>
        </div>

        <div className={focusCardClasses}>
          <textarea
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={MARKET_TITLE_MAX_LENGTH}
            placeholder={
              marketType === 'multiple_choice'
                ? "Who's first to leave the party?"
                : marketType === 'over_under'
                  ? 'How many drinks will Jake have tonight?'
                  : 'Will Jake finish the marathon?'
            }
            rows={2}
            onInput={(e) => {
              const el = e.currentTarget;
              el.style.height = 'auto';
              el.style.height = `${el.scrollHeight}px`;
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.preventDefault();
            }}
            className="block w-full resize-none overflow-hidden border-0 bg-transparent p-0 text-[19px] leading-[1.3] font-bold text-espresso-950 placeholder:text-espresso-200 focus:outline-none"
          />
          {title.length >= MARKET_TITLE_COUNTER_THRESHOLD && (
            <p className={cn('mt-2.5 text-right text-[11px]', title.length >= MARKET_TITLE_MAX_LENGTH ? 'text-danger-700' : 'text-espresso-300')}>
              {title.length} / {MARKET_TITLE_MAX_LENGTH}
            </p>
          )}
        </div>

        {isOverUnder && (
          <div className={cardClasses}>
            <p className="text-[13px] font-extrabold text-espresso-800">The line</p>
            <div className="mt-2.5 flex items-center gap-2.5">
              {/* Currencies read before the number everywhere else in the app (formatLine's
                  PREFIXED_UNITS), so the field you fill in is laid out the way the line will
                  actually read rather than "5.5 $". */}
              {isPrefixedUnit(unit) && lineFormat === 'number' && unitButton}
              {lineFormat === 'number' ? (
                <input
                  value={line}
                  onChange={(e) => setLine(e.target.value)}
                  type="number"
                  step="0.5"
                  inputMode="decimal"
                  placeholder="5.5"
                  className="min-w-0 flex-1 rounded-[14px] border-[1.5px] border-espresso-200 bg-paper-white px-3.5 py-3 text-xl font-extrabold text-espresso-950 placeholder:text-espresso-200 focus:border-honey-500 focus:outline-none"
                />
              ) : (
                <input
                  value={line}
                  onChange={(e) => setLine(e.target.value)}
                  type={lineFormat === 'date' ? 'date' : 'time'}
                  className="min-w-0 flex-1 rounded-[14px] border-[1.5px] border-espresso-200 bg-paper-white px-3.5 py-3 text-base font-extrabold text-espresso-950 focus:border-honey-500 focus:outline-none"
                />
              )}
              {!(isPrefixedUnit(unit) && lineFormat === 'number') && unitButton}
            </div>

            {unitPickerOpen && (
              <div className="mt-3 flex flex-wrap gap-2 border-t border-espresso-50 pt-3">
                {/* First, and always available: the way back out of a unit you didn't want. */}
                <button
                  type="button"
                  onClick={() => {
                    chooseFormat('number');
                    setUnit('');
                    setCustomUnit(false);
                  }}
                  className={cn(
                    'rounded-full border px-3 py-1 text-sm font-semibold',
                    lineFormat === 'number' && !unit.trim() && !customUnit
                      ? 'border-honey-500 bg-honey-50 text-honey-800'
                      : 'border-espresso-200 text-espresso-600'
                  )}
                >
                  No unit
                </button>
                {OVER_UNDER_UNIT_PRESETS.map((preset) => (
                  <button
                    type="button"
                    key={preset}
                    onPointerDown={preset === '$' ? startCurrencyPress : undefined}
                    onPointerUp={preset === '$' ? endCurrencyPress : undefined}
                    onPointerLeave={preset === '$' ? endCurrencyPress : undefined}
                    onClick={() => {
                      chooseFormat('number');
                      setUnit(preset);
                      setCustomUnit(false);
                    }}
                    className={cn(
                      'rounded-full border px-3 py-1 text-sm font-semibold',
                      lineFormat === 'number' && unit === preset && !customUnit
                        ? 'border-honey-500 bg-honey-50 text-honey-800'
                        : 'border-espresso-200 text-espresso-600'
                    )}
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
                        chooseFormat('number');
                        setUnit(alt);
                        setCustomUnit(false);
                      }}
                      className={cn(
                        'rounded-full border px-3 py-1 text-sm font-semibold',
                        lineFormat === 'number' && unit === alt && !customUnit
                          ? 'border-honey-500 bg-honey-50 text-honey-800'
                          : 'border-espresso-200 text-espresso-600'
                      )}
                    >
                      {alt}
                    </button>
                  ))}
                {(['date', 'time'] as const).map((f) => (
                  <button
                    type="button"
                    key={f}
                    onClick={() => {
                      chooseFormat(f);
                      setUnit('');
                      setCustomUnit(false);
                    }}
                    className={cn(
                      'rounded-full border px-3 py-1 text-sm font-semibold',
                      lineFormat === f ? 'border-honey-500 bg-honey-50 text-honey-800' : 'border-espresso-200 text-espresso-600'
                    )}
                  >
                    {f === 'date' ? 'a date' : 'a time'}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => {
                    chooseFormat('number');
                    setCustomUnit(true);
                    setUnit('');
                  }}
                  className={cn(
                    'rounded-full border px-3 py-1 text-sm font-semibold',
                    customUnit ? 'border-honey-500 bg-honey-50 text-honey-800' : 'border-espresso-200 text-espresso-600'
                  )}
                >
                  Custom
                </button>
                {customUnit && (
                  <input
                    autoFocus
                    value={unit}
                    onChange={(e) => setUnit(e.target.value)}
                    maxLength={OVER_UNDER_UNIT_MAX_LENGTH}
                    placeholder="e.g. laps, pints, minutes"
                    className="w-full rounded-xl border border-espresso-200 bg-paper-white px-3.5 py-2.5 text-sm text-espresso-900 placeholder:text-espresso-300 focus:border-honey-500 focus:outline-none"
                  />
                )}
                {!showCurrencyAlternates && !customUnit && (
                  <p className="w-full text-[11.5px] text-espresso-400">Hold $ for other currencies.</p>
                )}
              </div>
            )}

            {lineFormat !== 'number' && (
              <p className="mt-2.5 text-[11.5px] text-espresso-400">Bets settle either side of this exact point.</p>
            )}
          </div>
        )}

        {marketType === 'multiple_choice' && (
          <div className={cardClasses}>
            <p className="text-[13px] font-extrabold text-espresso-800">The options</p>
            <div className="mt-3 space-y-2.5">
              {options.map((option, i) => (
                <OptionRow
                  key={option.key}
                  index={i}
                  option={option}
                  members={members}
                  removable={options.length > 2}
                  onChange={(label) => setOptions(options.map((o) => (o.key === option.key ? { ...o, label } : o)))}
                  onRemove={() => setOptions(options.filter((o) => o.key !== option.key))}
                />
              ))}
              {options.length < 10 && (
                <button
                  type="button"
                  onClick={() => setOptions([...options, newOption()])}
                  className="w-full rounded-xl border border-dashed border-espresso-200 bg-transparent py-2.5 text-sm font-semibold text-espresso-500"
                >
                  + Add option
                </button>
              )}
            </div>
            <p className="mt-2.5 text-[11.5px] leading-[1.45] text-espresso-400">
              Type @ and pick a member to make an option about them. That hides the whole market from them until it
              resolves.
            </p>
          </div>
        )}

        {!hasOptionSubject && (
          <div className={cardClasses}>
            <p className="text-[13px] font-extrabold text-espresso-800">About someone?</p>
            <SubjectChips
              members={members}
              selected={subjects}
              onChange={setSubjects}
              maxSubjects={Math.max(0, totalMemberCount - 2)}
            />
            <p className="mt-2.5 text-[11.5px] leading-[1.45] text-espresso-400">
              {subjects.length === 0 ? (
                'Anyone you pick here stays in the dark until this market resolves.'
              ) : (
                <>
                  <Mention nickname={subjects[0].nickname} />
                  {subjects.length > 1 && ` and ${subjects.length - 1} more`}
                  {' won’t see this market until it resolves.'}
                </>
              )}
            </p>
          </div>
        )}

        <div className="mt-auto pt-6">
          <button type="button" onClick={goToStep2} className={footerButtonClasses}>
            Next · How it settles
          </button>
        </div>
      </div>
    );
  }

  if (step === 2) {
    return (
      <div className="flex flex-1 flex-col gap-[18px]">
        <StepBar step={2} label="Settle" onBack={() => setStep(1)} />
        {errorAlert}

        <h1 className={headingClasses}>How does it settle?</h1>

        <div className={focusCardClasses}>
          <p className={eyebrowClasses}>What counts as a win</p>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Be specific about what counts, e.g. the exact source or measurement used."
            rows={3}
            onInput={(e) => {
              const el = e.currentTarget;
              el.style.height = 'auto';
              el.style.height = `${el.scrollHeight}px`;
            }}
            className="mt-2 block w-full resize-none overflow-hidden border-0 bg-transparent p-0 text-[15px] leading-[1.45] text-espresso-950 placeholder:text-espresso-300 focus:outline-none"
          />
        </div>

        <div className={cardClasses}>
          <p className="text-[13px] font-extrabold text-espresso-800">Betting closes</p>
          <div className="relative mt-2.5 flex items-center gap-2.5 rounded-[14px] border-[1.5px] border-honey-500 px-3.5 py-3">
            <CalendarIcon className="h-[17px] w-[17px] shrink-0 text-honey-700" />
            <input
              type="datetime-local"
              min={minCloseTime}
              value={closesAt}
              onChange={(e) => setClosesAt(e.target.value)}
              className="min-w-0 flex-1 border-0 bg-transparent p-0 text-[15px] font-extrabold text-espresso-950 focus:outline-none"
            />
          </div>
          <p className="mt-2.5 text-[11.5px] leading-[1.45] text-espresso-400">
            Group time, {friendlyTimezoneName(timezone).replace(/ time$/, '')}. Set it to the earliest the outcome could
            be known.
          </p>
        </div>

        {requireEndorsement && (
          <div className="flex items-start gap-2.5 rounded-2xl bg-honey-50 px-4 py-3.5">
            <InfoIcon className="mt-px h-[17px] w-[17px] shrink-0 text-honey-800" />
            <p className="text-[12.5px] leading-[1.45] text-honey-900">
              One other member endorses this before betting opens. Nobody in 24 hours and it expires.
            </p>
          </div>
        )}

        <div className="mt-auto pt-6">
          <button type="button" onClick={goToStep3} className={footerButtonClasses}>
            Review the ticket
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-[18px]">
      <StepBar step={3} label="Review" onBack={() => setStep(2)} />
      {errorAlert}

      <ReviewTicket
        title={title}
        description={description}
        marketType={marketType}
        options={options}
        subjects={subjects}
        hasOptionSubject={hasOptionSubject}
        line={parsedLine}
        displayUnit={displayUnit}
        lineFormat={lineFormat}
        closesAtDate={closesAtDate}
        timezone={timezone}
        requireEndorsement={requireEndorsement}
      />

      <div className="mt-auto pt-6">
        <button type="button" disabled={isPending} onClick={submitMarket} className={footerButtonClasses}>
          {isPending ? 'Creating…' : 'Create market'}
        </button>
      </div>
    </div>
  );
}

/** One divided field row in the review ticket. Rows are separated rather than stacked so a long
 * criteria paragraph can't visually merge with the close time under it. */
function ReviewRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="border-t border-espresso-50 px-[18px] py-[13px]">
      <p className={eyebrowClasses}>{label}</p>
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
function ReviewTicket({
  title,
  description,
  marketType,
  options,
  subjects,
  hasOptionSubject,
  line,
  displayUnit,
  lineFormat,
  closesAtDate,
  timezone,
  requireEndorsement,
}: {
  title: string;
  description: string;
  marketType: MarketType;
  options: OptionDraft[];
  subjects: MemberOption[];
  hasOptionSubject: boolean;
  line: number | null;
  displayUnit: string | null;
  lineFormat: LineFormat;
  closesAtDate: Date;
  timezone: string;
  requireEndorsement: boolean;
}) {
  const lineIsWholeNumber = lineFormat === 'number' && line !== null && Number.isInteger(line);
  const kindLabel =
    marketType === 'yes_no' ? 'Yes / No' : marketType === 'over_under' ? 'Over / Under' : `One of ${options.length} options`;

  return (
    <div className="overflow-hidden rounded-[20px] border-[1.5px] border-espresso-800 bg-paper-white">
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
              A whole number can land on an exact tie, which the group would have to resolve as VOID.
            </p>
          )}
        </ReviewRow>
      )}

      <ReviewRow label="Betting closes">
        <p className="mt-1 text-[15px] font-extrabold text-espresso-950">
          {closesAtDate.toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
        </p>
        <p className="mt-1 text-xs text-espresso-400">Group time, {friendlyTimezoneName(timezone).replace(/ time$/, '')}.</p>
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
        {hasOptionSubject ? (
          <p className="mt-1 text-sm text-espresso-700">Every member an option names, until this resolves.</p>
        ) : subjects.length === 0 ? (
          <p className="mt-1 text-sm text-espresso-700">Nobody, this market is not about anyone in particular.</p>
        ) : (
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {subjects.map((s) => (
              <span key={s.userId} className="inline-flex items-center rounded-full bg-espresso-50 px-[11px] py-[5px] text-[13px] font-semibold">
                <Mention nickname={s.nickname} />
              </span>
            ))}
            <span className="text-[12.5px] text-espresso-400">won&apos;t see this market until it resolves</span>
          </div>
        )}
      </ReviewRow>

      {/* Only when endorsement is actually required. With the setting off, betting simply opens
          on create, which is what every other confirmation step in the app already implies — a
          highlighted callout to say "nothing unusual happens next" is a rule where there isn't
          one. */}
      {requireEndorsement && (
        <div className="flex items-start gap-2.5 border-t border-espresso-50 bg-honey-50 px-[18px] py-[13px]">
          <InfoIcon className="mt-px h-[17px] w-[17px] shrink-0 text-honey-800" />
          <p className="text-[13px] leading-[1.45] text-honey-900">
            One other member has to endorse this before betting opens. If nobody does within 24 hours, it expires.
          </p>
        </div>
      )}
    </div>
  );
}
