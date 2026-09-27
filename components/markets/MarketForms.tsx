'use client';

import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createMarket } from '@/lib/actions/markets';
import { SaveAsTemplateModal } from '@/components/markets/SaveAsTemplateModal';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { GroupAvatar } from '@/components/ui/GroupAvatar';
import { UserAvatar } from '@/components/ui/UserAvatar';
import { ScreenHeader, StickyFooter, FooterButton } from '@/components/ui/Screen';
import type { MarketType } from '@/lib/marketType';
import {
  OVER_UNDER_UNIT_PRESETS,
  OVER_UNDER_CURRENCY_ALTERNATES,
  OVER_UNDER_UNIT_MAX_LENGTH,
  parseLineInput,
  isPrefixedUnit,
  type LineFormat,
} from '@/lib/units';
import { friendlyTimezoneName } from '@/lib/timezone';
import { MARKET_TITLE_MAX_LENGTH, MARKET_TITLE_COUNTER_THRESHOLD, OPTION_LABEL_MAX_LENGTH } from '@/lib/limits';
import { cn } from '@/lib/cn';

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

/** One member as the create-market form needs them: enough for an @mention chip (with their face)
 *  and a subject id. */
export interface MemberOption {
  userId: string;
  nickname: string;
  avatarUpdatedAt?: string | null;
  avatarPresetKey?: string | null;
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

/** One option row (4i's "The options"): a lettered tile and the label field. A leading "@" shows
 *  a nickname autocomplete; picking one fills in the exact "@nickname". */
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

  return (
    <div className="relative">
      <div className="flex items-center gap-[11px] rounded-[14px] border border-hairline bg-surface px-[15px] py-[9px] focus-within:border-signal">
        <span className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-[7px] bg-tile font-mono text-[11px] font-semibold text-muted">
          {String.fromCharCode(65 + index)}
        </span>
        <input
          value={option.label}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 150)}
          placeholder={members.length > 0 ? 'An option, or @nickname' : 'An option'}
          maxLength={OPTION_LABEL_MAX_LENGTH}
          className="min-w-0 flex-1 border-0 bg-transparent py-0.5 text-[14.5px] font-bold text-ink placeholder:font-semibold placeholder:text-disabled-ink focus:outline-none"
        />
        {removable && (
          <button type="button" onClick={onRemove} aria-label="Remove option" className="shrink-0 text-[18px] leading-none text-faint">
            ×
          </button>
        )}
      </div>
      {suggestions.length > 0 && (
        <ul className="absolute z-10 mt-1 w-full overflow-hidden rounded-xl border border-hairline bg-surface">
          {suggestions.map((m) => (
            <li key={m.userId}>
              <button type="button" onClick={() => onChange(`@${m.nickname}`)} className="block w-full px-4 py-2 text-left text-[13px] font-bold text-ink hover:bg-signal-wash">
                @{m.nickname}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** 4i's person chips: face, @name, a check when picked. A group small enough to bet in is small
 *  enough to list; anyone picked stays visible even past the first page. */
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
  const isSelected = (m: MemberOption) => selected.some((s) => s.userId === m.userId);
  const shown = [...members.slice(0, visibleCount), ...members.slice(visibleCount).filter(isSelected)];
  const remaining = members.length - visibleCount;

  return (
    <>
      <div className="flex flex-wrap gap-[7px]">
        {shown.map((m) => {
          const on = isSelected(m);
          return (
            <button
              key={m.userId}
              type="button"
              disabled={!on && atCap}
              onClick={() => onChange(on ? selected.filter((s) => s.userId !== m.userId) : [...selected, m])}
              className={cn(
                'inline-flex items-center gap-[7px] rounded-full border-[1.5px] py-[5px] pr-[11px] pl-1.5 disabled:opacity-40',
                on ? 'border-signal bg-signal-wash' : 'border-hairline bg-surface'
              )}
            >
              <UserAvatar
                userId={m.userId}
                nickname={m.nickname}
                avatarUpdatedAt={m.avatarUpdatedAt ?? null}
                avatarPresetKey={m.avatarPresetKey ?? null}
                className="h-5 w-5 text-[8px]"
                fallbackClassName="bg-tile text-muted"
              />
              <span className={cn('text-[12.5px]', on ? 'font-bold text-ink' : 'font-semibold text-muted')}>@{m.nickname}</span>
              {on && (
                <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="#2d55f5" strokeWidth="2.4" strokeLinecap="round">
                  <path d="M2 6.3 4.6 9 10 3.2" />
                </svg>
              )}
            </button>
          );
        })}
      </div>
      {remaining > 0 && (
        <button type="button" onClick={() => setVisibleCount((c) => c + SUBJECT_PAGE_SIZE)} className="mt-2.5 text-[12.5px] font-bold text-signal">
          Show {Math.min(remaining, SUBJECT_PAGE_SIZE)} more
        </button>
      )}
    </>
  );
}

/** 4i/4i2's numbered section heading: a 20px ink chip with the step number, the label, and an
 *  optional right-hand note ("Optional"). */
function SectionHead({ n, label, note }: { n: number; label: string; note?: string }) {
  return (
    <div className="flex items-center gap-[9px]">
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-ink font-mono text-[11px] font-semibold text-surface">{n}</span>
      <p className="text-[13.5px] font-bold text-ink">{label}</p>
      {note && <span className="ml-auto shrink-0 text-[11px] font-bold text-faint">{note}</span>}
    </div>
  );
}

const TYPE_TILES: { type: MarketType; label: string; icon: React.ReactNode }[] = [
  { type: 'yes_no', label: 'Yes or no', icon: <path d="M5 8h6M5 16h6M15 6l3 3 3-6" /> },
  {
    type: 'multiple_choice',
    label: 'Pick a winner',
    icon: (
      <>
        <circle cx="6" cy="7" r="2" />
        <circle cx="6" cy="17" r="2" />
        <path d="M11 7h8M11 17h8" />
      </>
    ),
  },
  { type: 'over_under', label: 'A number', icon: <path d="M4 18h16M7 18V9M12 18V5M17 18v-6" /> },
];

/** "Tonight" (today 9pm, or tomorrow's if that's already gone) and the next Saturday 2pm — the
 *  two presets 4i offers ahead of "Pick a time". */
function presetTimes(): { tonight: Date; saturday: Date } {
  const now = new Date();
  const tonight = new Date(now);
  tonight.setHours(21, 0, 0, 0);
  if (tonight.getTime() - now.getTime() < 30 * 60_000) tonight.setDate(tonight.getDate() + 1);
  const saturday = new Date(now);
  const daysToSat = (6 - now.getDay() + 7) % 7 || 7;
  saturday.setDate(now.getDate() + daysToSat);
  saturday.setHours(14, 0, 0, 0);
  return { tonight, saturday };
}

export function CreateMarketForm({
  groupId,
  groupName,
  groupAvatarKey,
  members,
  totalMemberCount,
  timezone,
  requireEndorsement,
  initialMarketType,
  isPublic = false,
  initialTitle,
  initialDescription,
  initialOptions,
  initialSubjectIds,
  initialUnit,
}: {
  groupId: string;
  groupName: string;
  groupAvatarKey?: string | null;
  members: MemberOption[];
  totalMemberCount: number;
  timezone: string;
  requireEndorsement: boolean;
  /** The type picked on the + menu (4p); still changeable here, in section 1. */
  initialMarketType?: MarketType;
  /** Public groups can never have a subject — create_market() rejects it — so section 4 and the
   *  @mention hints are dropped rather than offering something that would come back as an error. */
  isPublic?: boolean;
  /** Prefill from a template (see the route's `templateId`/`memberId` and applyTemplate()). */
  initialTitle?: string;
  initialDescription?: string;
  initialOptions?: string[];
  initialSubjectIds?: string[];
  initialUnit?: string | null;
}) {
  const router = useRouter();
  const [marketType, setMarketType] = useState<MarketType>(initialMarketType ?? 'yes_no');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const [title, setTitle] = useState(initialTitle ?? '');
  const [description, setDescription] = useState(initialDescription ?? '');
  const [line, setLine] = useState('');
  const [unit, setUnit] = useState(initialUnit ?? '');
  const [lineFormat, setLineFormat] = useState<LineFormat>('number');
  const [customUnit, setCustomUnit] = useState(false);
  const [showCurrencyAlternates, setShowCurrencyAlternates] = useState(false);
  const currencyPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [subjects, setSubjects] = useState<MemberOption[]>(() => members.filter((m) => initialSubjectIds?.includes(m.userId)));
  const [aboutSomeone, setAboutSomeone] = useState(() => (initialSubjectIds?.length ?? 0) > 0);
  const [options, setOptions] = useState<OptionDraft[]>(() =>
    initialOptions && initialOptions.length > 0 ? initialOptions.map((label) => newOption(label)) : [newOption(), newOption()]
  );
  const [saveTemplateOpen, setSaveTemplateOpen] = useState(false);
  const [minCloseTime] = useState(() => toLocalDatetimeInputValue(new Date(Date.now() + 60_000)));
  const [presets] = useState(presetTimes);
  const [closeChoice, setCloseChoice] = useState<'tonight' | 'saturday' | 'custom'>('tonight');
  const [customClose, setCustomClose] = useState(() => toLocalDatetimeInputValue(new Date(Date.now() + 60 * 60_000)));

  const closesAt =
    closeChoice === 'tonight' ? toLocalDatetimeInputValue(presets.tonight) : closeChoice === 'saturday' ? toLocalDatetimeInputValue(presets.saturday) : customClose;

  function startCurrencyPress() {
    currencyPressTimer.current = setTimeout(() => setShowCurrencyAlternates(true), 450);
  }
  function endCurrencyPress() {
    if (currencyPressTimer.current) {
      clearTimeout(currencyPressTimer.current);
      currencyPressTimer.current = null;
    }
  }

  // A multiple choice market is "about" someone one way at a time: an @mentioned option, or the
  // people picked in section 4, never both.
  const hasOptionSubject = marketType === 'multiple_choice' && options.some((o) => o.label.trim().startsWith('@'));
  useEffect(() => {
    if (hasOptionSubject) {
      setSubjects([]);
      setAboutSomeone(false);
    }
  }, [hasOptionSubject]);

  const isOverUnder = marketType === 'over_under';
  const displayUnit = lineFormat === 'number' ? unit.trim() || null : lineFormat;
  const maxSubjects = Math.max(0, totalMemberCount - 2);

  function submitMarket() {
    setError(null);
    if (!title.trim()) return setError('Every market needs a question.');
    if (isOverUnder && line === '') return setError('Set the line this market is bet against.');
    if (marketType === 'multiple_choice') {
      const trimmed = options.map((o) => o.label.trim());
      if (trimmed.some((l) => l === '')) return setError('Every option needs a label.');
      if (new Set(trimmed).size !== trimmed.length) return setError('Option labels must be unique.');
    }
    if (!description.trim()) return setError('Say what counts as a win.');
    if (!closesAt) return setError('Set when betting closes.');
    startTransition(async () => {
      const result = await createMarket({
        groupId,
        title: title.trim(),
        description: description.trim(),
        marketType,
        closesAt: new Date(closesAt).toISOString(),
        line: isOverUnder ? parseLineInput(line, lineFormat) : null,
        unit: isOverUnder ? displayUnit : null,
        subjectUserIds: hasOptionSubject || !aboutSomeone ? [] : subjects.map((s) => s.userId),
        options: marketType === 'multiple_choice' ? options.map((o) => o.label.trim()) : undefined,
      });
      if (result.error) setError(result.error);
      else router.push(`/groups/${groupId}/markets/${result.data!.id}`);
    });
  }

  /** Switching what the line *is* resets what it says, but only on a real change. */
  function chooseFormat(next: LineFormat) {
    if (next !== lineFormat) setLine(defaultLineFor(next));
    setLineFormat(next);
  }

  const lineNumberShown = line !== '' ? line : '4.5';
  const errorAlert = error && (
    <Modal onClose={() => setError(null)}>
      <p className="font-display font-bold text-ink">Not quite there</p>
      <p className="text-sm leading-[1.5] text-muted">{error}</p>
      <Button className="w-full" onClick={() => setError(null)}>
        Got it
      </Button>
    </Modal>
  );

  const chip = (on: boolean) =>
    cn('rounded-full px-[11px] py-[5px] text-[12px]', on ? 'border border-signal-edge bg-signal-tint font-bold text-signal' : 'border border-hairline bg-surface font-semibold text-muted');

  const presetLabel = (d: Date) => d.toLocaleDateString('en-GB', { weekday: 'short' }) + ' ' + d.toLocaleTimeString('en-GB', { hour: 'numeric', hour12: true }).replace(' ', '').toLowerCase();

  return (
    <div className="-mx-[18px] -mt-6">
      <ScreenHeader
        title="Propose a market"
        tile="close"
        href={`/groups/${groupId}`}
        right={
          <span className="inline-flex shrink-0 items-center gap-1.5 text-[12.5px] font-semibold text-muted">
            <GroupAvatar name={groupName} avatarKey={groupAvatarKey ?? null} className="h-5 w-5 text-[8px]" fallbackClassName="bg-ink text-on-ink" />
            {groupName.split(/\s+/)[0]}
          </span>
        }
      />
      {errorAlert}

      <div className="px-[18px] pt-5">
        <SectionHead n={1} label="What kind of question" />
        <div className="mt-[9px] flex gap-2">
          {TYPE_TILES.map((t) => {
            const on = marketType === t.type;
            return (
              <button
                key={t.type}
                type="button"
                onClick={() => setMarketType(t.type)}
                className={cn(
                  'flex flex-1 flex-col items-center gap-1.5 rounded-[14px] border-[1.5px] py-[11px]',
                  on ? 'border-signal bg-signal-wash text-signal' : 'border-hairline bg-surface text-muted'
                )}
              >
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  {t.icon}
                </svg>
                <span className="text-[11.5px] font-bold">{t.label}</span>
              </button>
            );
          })}
        </div>

        <div className="mt-[15px]">
          <SectionHead n={2} label="The question" />
        </div>
        <div className="mt-[9px] rounded-2xl border-[1.5px] border-signal bg-surface px-4 py-3.5">
          <textarea
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={MARKET_TITLE_MAX_LENGTH}
            placeholder={
              marketType === 'multiple_choice'
                ? "Who's buying the first round?"
                : isOverUnder
                  ? 'How many pints does Sam get through at the quiz?'
                  : 'Will Gaz wear the shirt to the wedding?'
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
            className="block w-full resize-none overflow-hidden border-0 bg-transparent p-0 text-[16px] leading-[1.35] font-bold text-ink placeholder:font-semibold placeholder:text-disabled-ink focus:outline-none"
          />
          {title.length >= MARKET_TITLE_COUNTER_THRESHOLD && (
            <p className={cn('mt-2 text-right font-mono text-[11px]', title.length >= MARKET_TITLE_MAX_LENGTH ? 'text-alert' : 'text-faint')}>
              {title.length}/{MARKET_TITLE_MAX_LENGTH}
            </p>
          )}
        </div>
        {!isPublic && <p className="mt-[7px] text-[11.5px] text-faint">Type @ to name anyone in the group.</p>}

        <div className="mt-[15px]">
          <SectionHead n={3} label={isOverUnder ? 'The line' : 'The options'} />
        </div>
        {marketType === 'yes_no' && (
          // A yes/no market's two sides are always Yes and No — shown as the options they are,
          // not as fields, since the data model has no custom labels for them.
          <div className="mt-[9px] flex flex-col gap-2">
            {['Yes', 'No'].map((label, i) => (
              <div key={label} className="flex items-center gap-[11px] rounded-[14px] border border-hairline bg-surface px-[15px] py-[11px]">
                <span className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-[7px] bg-tile font-mono text-[11px] font-semibold text-muted">
                  {String.fromCharCode(65 + i)}
                </span>
                <span className="min-w-0 flex-1 text-[14.5px] font-bold text-ink">{label}</span>
              </div>
            ))}
          </div>
        )}
        {marketType === 'multiple_choice' && (
          <div className="mt-[9px] flex flex-col gap-2">
            {options.map((option, i) => (
              <OptionRow
                key={option.key}
                index={i}
                option={option}
                members={isPublic ? [] : members}
                removable={options.length > 2}
                onChange={(label) => setOptions(options.map((o) => (o.key === option.key ? { ...o, label } : o)))}
                onRemove={() => setOptions(options.filter((o) => o.key !== option.key))}
              />
            ))}
            {options.length < 10 && (
              <button
                type="button"
                onClick={() => setOptions([...options, newOption()])}
                className="w-full rounded-[14px] border border-dashed border-dash bg-transparent py-[11px] text-[13px] font-bold text-muted"
              >
                Add an option
              </button>
            )}
            {!isPublic && <p className="text-[11.5px] leading-[1.45] text-faint">Start an option with @ to make it a person. They won&apos;t see this market until it resolves.</p>}
          </div>
        )}
        {isOverUnder && (
          <div className="mt-[9px] rounded-2xl border border-hairline bg-surface px-[15px] pt-[13px] pb-3.5">
            <div className="flex items-center gap-[9px]">
              {lineFormat === 'number' ? (
                <span className="flex min-w-0 flex-1 items-center rounded-[14px] border-[1.5px] border-edge bg-canvas px-3.5 py-[11px] focus-within:border-signal">
                  {isPrefixedUnit(unit) && <span className="mr-1 font-mono text-[24px] leading-none font-semibold text-ink">{unit}</span>}
                  <input
                    value={line}
                    onChange={(e) => setLine(e.target.value)}
                    type="number"
                    step="0.5"
                    inputMode="decimal"
                    placeholder="4.5"
                    className="min-w-0 flex-1 border-0 bg-transparent p-0 font-mono text-[24px] leading-none font-semibold tracking-[-0.02em] text-ink placeholder:text-dash focus:outline-none"
                  />
                </span>
              ) : (
                <input
                  value={line}
                  onChange={(e) => setLine(e.target.value)}
                  type={lineFormat === 'date' ? 'date' : 'time'}
                  className="min-w-0 flex-1 rounded-[14px] border-[1.5px] border-edge bg-canvas px-3.5 py-[11px] font-mono text-[18px] font-semibold text-ink focus:border-signal focus:outline-none"
                />
              )}
              {lineFormat === 'number' && !isPrefixedUnit(unit) && (
                <span className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-ink px-[13px] py-[11px] text-[13px] font-bold text-surface">
                  {unit.trim() || 'no unit'}
                </span>
              )}
            </div>
            {lineFormat === 'number' && (
              <div className="mt-[9px] flex flex-wrap gap-1.5">
                {OVER_UNDER_UNIT_PRESETS.map((preset) => (
                  <button
                    type="button"
                    key={preset}
                    onPointerDown={preset === '$' ? startCurrencyPress : undefined}
                    onPointerUp={preset === '$' ? endCurrencyPress : undefined}
                    onPointerLeave={preset === '$' ? endCurrencyPress : undefined}
                    onClick={() => {
                      setUnit(unit === preset ? '' : preset);
                      setCustomUnit(false);
                    }}
                    className={cn(chip(unit === preset && !customUnit), preset === '$' && 'font-mono')}
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
                        setCustomUnit(false);
                      }}
                      className={cn(chip(unit === alt && !customUnit), 'font-mono')}
                    >
                      {alt}
                    </button>
                  ))}
                {unit && !(OVER_UNDER_UNIT_PRESETS as readonly string[]).includes(unit) && !(OVER_UNDER_CURRENCY_ALTERNATES as readonly string[]).includes(unit) && !customUnit && (
                  <span className={chip(true)}>{unit}</span>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setCustomUnit(true);
                    setUnit('');
                  }}
                  className={chip(customUnit)}
                >
                  Custom
                </button>
                {customUnit && (
                  <input
                    autoFocus
                    value={unit}
                    onChange={(e) => setUnit(e.target.value)}
                    maxLength={OVER_UNDER_UNIT_MAX_LENGTH}
                    placeholder="e.g. pints, laps, minutes"
                    className="w-full rounded-xl border border-hairline bg-surface px-3 py-2 text-[13px] text-ink placeholder:text-faint focus:border-signal focus:outline-none"
                  />
                )}
              </div>
            )}
            <div className="mt-2.5 flex gap-1.5 border-t border-rule pt-2.5">
              {(['number', 'date', 'time'] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => {
                    chooseFormat(f);
                    if (f !== 'number') {
                      setUnit('');
                      setCustomUnit(false);
                    }
                  }}
                  className={cn(
                    'flex-1 rounded-[11px] py-2 text-center text-[12px]',
                    lineFormat === f ? 'border-[1.5px] border-ink bg-canvas font-bold text-ink' : 'border border-hairline bg-surface font-semibold text-muted'
                  )}
                >
                  {f === 'number' ? 'A number' : f === 'date' ? 'A date' : 'A time'}
                </button>
              ))}
            </div>
            <div className="mt-[11px] flex items-center gap-[9px] rounded-xl border border-signal-line bg-signal-wash px-3 py-2.5">
              <span className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-[7px] bg-signal text-surface">
                <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                  <path d="M2 6.3 4.6 9 10 3.2" />
                </svg>
              </span>
              <p className="text-[12px] leading-[1.45] text-muted text-pretty">
                {lineFormat === 'number' ? (
                  <>
                    Everyone bets <span className="font-bold text-ink">Over {lineNumberShown}</span> or <span className="font-bold text-ink">Under {lineNumberShown}</span>.{' '}
                    {Number.isInteger(Number(lineNumberShown)) ? 'A whole number can tie, which voids the market.' : 'A half means nobody can tie.'}
                  </>
                ) : (
                  <>Everyone bets before or after this exact point.</>
                )}
              </p>
            </div>
          </div>
        )}

        {!isPublic && !hasOptionSubject && (
          <>
            <div className="mt-[15px]">
              <SectionHead n={4} label="Is this about someone?" note="Optional" />
            </div>
            <div className="mt-[9px] flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setAboutSomeone(false);
                  setSubjects([]);
                }}
                className={cn(
                  'flex flex-1 items-center justify-center rounded-[14px] border-[1.5px] py-[11px] text-[13px] font-bold',
                  !aboutSomeone ? 'border-ink bg-ink text-surface' : 'border-hairline bg-surface text-muted'
                )}
              >
                No
              </button>
              <button
                type="button"
                onClick={() => setAboutSomeone(true)}
                className={cn(
                  'flex flex-1 items-center justify-center rounded-[14px] border-[1.5px] py-[11px] text-[13px] font-bold',
                  aboutSomeone ? 'border-ink bg-ink text-surface' : 'border-hairline bg-surface text-muted'
                )}
              >
                Yes, these people
              </button>
            </div>
            {aboutSomeone && (
              <div className="mt-2 rounded-[14px] border border-hairline bg-surface px-[13px] py-[11px]">
                <SubjectChips members={members} selected={subjects} onChange={setSubjects} maxSubjects={maxSubjects} />
                <p className="mt-[9px] border-t border-rule pt-[9px] text-[11.5px] leading-[1.45] text-faint text-pretty">
                  {subjects.length === 0
                    ? "Pick who it's about. They won't see this market and can't bet on it."
                    : `${subjects.map((s) => `@${s.nickname}`).join(subjects.length === 2 ? ' and ' : ', ')} won't see this market and can't bet on it.`}
                </p>
              </div>
            )}
          </>
        )}

        <div className="mt-[15px]">
          <SectionHead n={isPublic || hasOptionSubject ? 4 : 5} label="Closing and criteria" />
        </div>
        <div className="mt-[9px] flex gap-2">
          <button
            type="button"
            onClick={() => setCloseChoice('tonight')}
            className={cn('flex-1 rounded-xl py-2.5 text-center text-[13px]', closeChoice === 'tonight' ? 'bg-ink font-bold text-surface' : 'border border-hairline bg-surface font-semibold text-muted')}
          >
            Tonight
          </button>
          <button
            type="button"
            onClick={() => setCloseChoice('saturday')}
            className={cn('flex-1 rounded-xl py-2.5 text-center text-[13px]', closeChoice === 'saturday' ? 'bg-ink font-bold text-surface' : 'border border-hairline bg-surface font-semibold text-muted')}
          >
            {presetLabel(presets.saturday)}
          </button>
          <button
            type="button"
            onClick={() => setCloseChoice('custom')}
            className={cn('flex-1 rounded-xl py-2.5 text-center text-[13px]', closeChoice === 'custom' ? 'bg-ink font-bold text-surface' : 'border border-hairline bg-surface font-semibold text-muted')}
          >
            Pick a time
          </button>
        </div>
        {closeChoice === 'custom' ? (
          <input
            type="datetime-local"
            min={minCloseTime}
            value={customClose}
            onChange={(e) => setCustomClose(e.target.value)}
            className="mt-2 block w-full rounded-xl border-[1.5px] border-signal bg-surface px-3.5 py-2.5 font-mono text-[14px] font-semibold text-ink focus:outline-none"
          />
        ) : (
          <p className="mt-[7px] text-[11.5px] text-faint">
            Closes {new Date(closesAt).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}, {friendlyTimezoneName(timezone).replace(/ time$/, '')} time.
          </p>
        )}
        <div className="mt-2 rounded-2xl border border-hairline bg-surface px-[15px] py-3 focus-within:border-signal">
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What counts as a win? Be specific, e.g. the exact source."
            rows={2}
            onInput={(e) => {
              const el = e.currentTarget;
              el.style.height = 'auto';
              el.style.height = `${el.scrollHeight}px`;
            }}
            className="block w-full resize-none overflow-hidden border-0 bg-transparent p-0 text-[13px] leading-[1.5] text-muted placeholder:text-disabled-ink focus:outline-none"
          />
        </div>

        <p className="mt-[13px] text-[12px] leading-[1.5] text-faint text-pretty">
          {requireEndorsement
            ? 'One person in the group has to endorse this before anyone can bet. Anyone can call the result later.'
            : 'Betting opens as soon as you put it up. Anyone can call the result later.'}
        </p>
        <button type="button" onClick={() => setSaveTemplateOpen(true)} className="mt-2 text-[12px] font-bold text-signal">
          Save as a template
        </button>
      </div>

      <StickyFooter>
        <FooterButton onClick={submitMarket} disabled={isPending}>
          {isPending ? 'Putting it up' : 'Put it to the group'}
        </FooterButton>
      </StickyFooter>

      {saveTemplateOpen && (
        <SaveAsTemplateModal
          groupId={groupId}
          groupName={groupName}
          draftTitle={title}
          description={description}
          marketType={marketType}
          options={options.map((o) => o.label.trim())}
          subjects={aboutSomeone ? subjects : []}
          unit={isOverUnder ? displayUnit : null}
          onClose={() => setSaveTemplateOpen(false)}
        />
      )}
    </div>
  );
}
