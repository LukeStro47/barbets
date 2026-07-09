'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createMarket } from '@/lib/actions/markets';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { SubjectPicker, type MemberOption } from '@/components/markets/SubjectPicker';
import { TimezoneCaption } from '@/components/ui/TimezoneCaption';
import { Mention } from '@/components/ui/Mention';

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
  const [minCloseTime] = useState(() => toLocalDatetimeInputValue(new Date(Date.now() + 60_000)));
  const [defaultCloseTime] = useState(() => toLocalDatetimeInputValue(new Date(Date.now() + 24 * 3_600_000)));
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

    if (marketType === 'over_under' && Number.isInteger(Number(formData.get('line')))) {
      setPendingFormData(formData);
      return;
    }

    submitMarket(formData);
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
          <input
            name="title"
            placeholder={
              marketType === 'multiple_choice'
                ? "Who's first to leave the party?"
                : marketType === 'over_under'
                  ? 'How many drinks will Jake have tonight?'
                  : 'Will Jake finish the marathon?'
            }
            required
            className={inputClasses}
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
          <div className="space-y-1.5">
            <label className="block text-sm font-semibold text-espresso-700">The line</label>
            <input
              name="line"
              type="number"
              step="0.5"
              placeholder="e.g. 5.5 (use a half to avoid a push)"
              required
              className={inputClasses}
            />
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-espresso-950/40 px-5">
          <div className="w-full max-w-sm space-y-3 rounded-2xl bg-paper-white p-5 shadow-xl">
            <p className="font-display font-bold text-espresso-900">Use a whole number for the line?</p>
            <p className="text-sm text-espresso-500">
              A whole number can land on an exact tie, which the group would have to resolve as VOID. A half (like
              3.5) avoids that entirely. Sure you want a whole number?
            </p>
            <div className="flex gap-2">
              <Button type="button" variant="outline" className="flex-1" onClick={() => setPendingFormData(null)}>
                Let me fix it
              </Button>
              <Button
                type="button"
                className="flex-1"
                onClick={() => {
                  const formData = pendingFormData;
                  setPendingFormData(null);
                  if (formData) submitMarket(formData);
                }}
              >
                Use it anyway
              </Button>
            </div>
          </div>
        </div>
      )}
    </form>
  );
}
