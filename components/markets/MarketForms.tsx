'use client';

import { useMemo, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createMarket } from '@/lib/actions/markets';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { SubjectPicker, type MemberOption } from '@/components/markets/SubjectPicker';
import { OptionLabel } from '@/components/markets/OptionLabel';
import { TimezoneCaption } from '@/components/ui/TimezoneCaption';
import { Mention } from '@/components/ui/Mention';
import {
  OVER_UNDER_UNIT_PRESETS,
  OVER_UNDER_CURRENCY_ALTERNATES,
  OVER_UNDER_UNIT_MAX_LENGTH,
  OVER_UNDER_UNIT_INLINE_MAX_LENGTH,
  formatLine,
} from '@/lib/units';

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
    <div className="flex items-center gap-2">
      <span className="w-5 shrink-0 text-center text-xs font-semibold text-espresso-400">{index + 1}</span>
      <div className="relative flex-1">
        <input
          value={option.label}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 150)}
          placeholder={`Option ${index + 1}, or @nickname`}
          className={`w-full rounded-lg border px-3 py-1.5 text-sm placeholder:text-espresso-300 focus:outline-none focus:ring-2 ${
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
                  className="block w-full px-3 py-1.5 text-left text-sm text-espresso-800 hover:bg-honey-50"
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
          className="shrink-0 rounded-full px-2 text-espresso-400 hover:text-danger-700"
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
    <div className="space-y-2">
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
          className="w-full rounded-xl border border-dashed border-espresso-200 py-2 text-sm font-semibold text-espresso-500 hover:border-honey-400 hover:text-honey-700"
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
}: {
  groupId: string;
  members: MemberOption[];
  totalMemberCount: number;
  timezone: string;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [marketType, setMarketType] = useState<'yes_no' | 'over_under' | 'multiple_choice'>('yes_no');
  const [subjects, setSubjects] = useState<MemberOption[]>([]);
  const [options, setOptions] = useState<OptionDraft[]>(() => [newOption(), newOption()]);
  const [unit, setUnit] = useState('');
  const [otherUnit, setOtherUnit] = useState(false);
  const unitIsLong = unit.trim().length > OVER_UNDER_UNIT_INLINE_MAX_LENGTH;
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
  const [defaultCloseTime] = useState(() => toLocalDatetimeInputValue(new Date(Date.now() + 30 * 60_000)));
  const [pendingFormData, setPendingFormData] = useState<FormData | null>(null);

  function submitMarket(formData: FormData) {
    const closesAtLocal = String(formData.get('closesAt'));
    startTransition(async () => {
      const result = await createMarket({
        groupId,
        title: String(formData.get('title')),
        description: String(formData.get('description')),
        marketType,
        closesAt: new Date(closesAtLocal).toISOString(),
        line: marketType === 'over_under' ? Number(formData.get('line')) : null,
        unit: marketType === 'over_under' ? unit.trim() || null : null,
        subjectUserIds: marketType === 'multiple_choice' ? [] : subjects.map((s) => s.userId),
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

      <Card className="space-y-3">
        <div className="flex flex-wrap gap-2">
          {(['yes_no', 'over_under', 'multiple_choice'] as const).map((t) => (
            <button
              type="button"
              key={t}
              onClick={() => setMarketType(t)}
              className={`rounded-full border px-4 py-1.5 text-sm font-semibold ${
                marketType === t ? 'border-honey-500 bg-honey-50 text-honey-800' : 'border-espresso-200 text-espresso-600'
              }`}
            >
              {t === 'yes_no' ? 'YES / NO' : t === 'over_under' ? 'OVER / UNDER' : 'MULTIPLE CHOICE'}
            </button>
          ))}
        </div>

        <div className="space-y-1.5">
          <label className="block text-sm font-semibold text-espresso-700">Market title</label>
          <textarea
            name="title"
            placeholder={
              marketType === 'multiple_choice'
                ? "Who's first to leave the party?"
                : marketType === 'over_under'
                  ? 'How many drinks will Jake have tonight?'
                  : 'Will Jake finish the marathon?'
            }
            required
            rows={1}
            onInput={(e) => {
              const el = e.currentTarget;
              el.style.height = 'auto';
              el.style.height = `${el.scrollHeight}px`;
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.preventDefault();
            }}
            className={`${inputClasses} resize-none overflow-hidden`}
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
                <input
                  name="line"
                  type="number"
                  step="0.5"
                  placeholder="5.5 (use a half to avoid a push)"
                  required
                  className={`${inputClasses} ${otherUnit && !unitIsLong ? 'min-w-0 flex-1' : 'w-full basis-full'}`}
                />
                {otherUnit && (
                  <input
                    value={unit}
                    onChange={(e) => setUnit(e.target.value)}
                    maxLength={OVER_UNDER_UNIT_MAX_LENGTH}
                    placeholder="Unit"
                    className={`${inputClasses} ${unitIsLong ? 'basis-full' : 'w-24 shrink-0'}`}
                  />
                )}
              </div>
            </div>

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
              {!showCurrencyAlternates && <p className="text-xs text-espresso-400">Hold $ for other currencies.</p>}
            </div>
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
        <Card>
          <h3 className="mb-2 font-semibold text-espresso-800">Options</h3>
          <MultipleChoiceOptionsEditor members={members} options={options} setOptions={setOptions} />
        </Card>
      ) : (
        <Card>
          <h3 className="mb-2 font-semibold text-espresso-800">About (optional)</h3>
          <SubjectPicker members={members} selected={subjects} onChange={setSubjects} totalMemberCount={totalMemberCount} />
        </Card>
      )}

      <Button type="submit" disabled={isPending} className="w-full" size="lg">
        {isPending ? 'Creating…' : 'Create market'}
      </Button>
      <p className="text-center text-xs text-espresso-400">
        One other member needs to endorse this before it opens. Unendorsed markets expire after 72 hours.
      </p>

      {pendingFormData && (
        <ReviewMarketModal
          formData={pendingFormData}
          marketType={marketType}
          subjects={subjects}
          options={options}
          unit={unit}
          timezone={timezone}
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

function ReviewMarketModal({
  formData,
  marketType,
  subjects,
  options,
  unit,
  timezone,
  onEdit,
  onConfirm,
}: {
  formData: FormData;
  marketType: 'yes_no' | 'over_under' | 'multiple_choice';
  subjects: MemberOption[];
  options: OptionDraft[];
  unit: string;
  timezone: string;
  onEdit: () => void;
  onConfirm: () => void;
}) {
  const title = String(formData.get('title'));
  const description = String(formData.get('description'));
  const closesAtLocal = String(formData.get('closesAt'));
  const closesAtDate = new Date(closesAtLocal);
  const line = marketType === 'over_under' ? Number(formData.get('line')) : null;
  const lineIsWholeNumber = line !== null && Number.isInteger(line);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-espresso-950/40 px-5">
      <div className="w-full max-w-sm space-y-4 rounded-2xl bg-paper-white p-5 shadow-xl">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-espresso-400">Review your market</p>
          <p className="mt-1 font-display text-lg font-bold text-espresso-900">{title}</p>
        </div>

        <div className="space-y-2 text-sm">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-espresso-400">Resolution criteria</p>
            <p className="text-espresso-700">{description}</p>
          </div>

          {marketType === 'over_under' && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-espresso-400">Line</p>
              <p className="text-espresso-700">{formatLine(line, unit.trim() || null)}</p>
              {lineIsWholeNumber && (
                <p className="mt-1 rounded-lg bg-honey-50 px-2.5 py-1.5 text-xs text-honey-800">
                  A whole number can land on an exact tie, which the group would have to resolve as VOID. A half
                  (like 3.5) avoids that entirely.
                </p>
              )}
            </div>
          )}

          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-espresso-400">Betting closes</p>
            <p className="text-espresso-700">
              {closesAtDate.toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
            </p>
            <TimezoneCaption groupTimezone={timezone} />
          </div>

          {marketType === 'multiple_choice' ? (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-espresso-400">Options</p>
              <ul className="mt-1 space-y-1">
                {options.map((o) => (
                  <li key={o.key} className="text-espresso-700">
                    <OptionLabel label={o.label.trim()} />
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-espresso-400">About</p>
              <p className="text-espresso-700">
                {subjects.length === 0 ? (
                  'Nobody, this market is not about anyone in particular.'
                ) : (
                  <>
                    Hidden from{' '}
                    {subjects.map((s, i) => (
                      <span key={s.userId}>
                        {i > 0 && ', '}
                        <Mention nickname={s.nickname} />
                      </span>
                    ))}
                  </>
                )}
              </p>
            </div>
          )}
        </div>

        <div className="flex gap-2">
          <Button type="button" variant="outline" className="flex-1" onClick={onEdit}>
            Edit
          </Button>
          <Button type="button" className="flex-1" onClick={onConfirm}>
            Create market
          </Button>
        </div>
      </div>
    </div>
  );
}
