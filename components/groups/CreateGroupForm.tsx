'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createGroup } from '@/lib/actions/groups';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Switch } from '@/components/ui/Switch';
import { formatSeasonLength, type SeasonLength } from '@/lib/seasonLength';
import { COMMON_TIMEZONES, friendlyTimezoneName } from '@/lib/timezone';

const inputClasses =
  'w-full rounded-xl border border-espresso-200 bg-paper-white px-4 py-2.5 text-espresso-900 focus:border-honey-500 focus:outline-none focus:ring-2 focus:ring-honey-200';

function Field({ label, hint, children }: { label: string; hint: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="block font-semibold text-espresso-800">{label}</label>
      <p className="text-sm text-espresso-500">{hint}</p>
      {children}
    </div>
  );
}

export function CreateGroupForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [seasonsEnabled, setSeasonsEnabled] = useState(false);
  const [seasonLength, setSeasonLength] = useState<SeasonLength>('manual');
  // Starts at 'UTC' (matches server render) then snaps to the browser's own
  // zone once mounted — detecting it during the initial render would read
  // the server's time zone during SSR and mismatch on hydration.
  const [timezone, setTimezone] = useState('UTC');
  useEffect(() => {
    try {
      setTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone);
    } catch {
      // stays 'UTC'
    }
  }, []);

  function handleSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await createGroup({
        name: String(formData.get('name')),
        seedAmount: Number(formData.get('seedAmount')),
        seasonsEnabled,
        seasonLength: seasonsEnabled ? seasonLength : null,
        nickname: String(formData.get('nickname')).trim(),
        timezone,
      });
      if (result.error) {
        setError(result.error);
      } else {
        router.push(`/groups/${result.data!.id}`);
      }
    });
  }

  return (
    <form action={handleSubmit} className="space-y-5">
      {error && <p className="text-sm text-danger-700">{error}</p>}

      <Card>
        <Field label="Group name" hint="What your friends will see when they get the invite.">
          <input name="name" placeholder="The Wednesday Wagers" required className={inputClasses} />
        </Field>
      </Card>

      <Card>
        <Field label="Your nickname" hint="This is what you'll be @mentioned as in this group. One word: letters, numbers, and underscores only.">
          <input
            name="nickname"
            placeholder="e.g. dan"
            required
            maxLength={20}
            onChange={(e) => {
              const lower = e.target.value.toLowerCase();
              if (lower !== e.target.value) e.target.value = lower;
            }}
            className={inputClasses}
          />
        </Field>
      </Card>

      <Card>
        <Field label="Time zone" hint="Shown next to betting-closes times so everyone knows what zone you meant.">
          <select value={timezone} onChange={(e) => setTimezone(e.target.value)} className={inputClasses}>
            {!(COMMON_TIMEZONES as readonly string[]).includes(timezone) && (
              <option value={timezone}>{friendlyTimezoneName(timezone)}</option>
            )}
            {COMMON_TIMEZONES.map((tz) => (
              <option key={tz} value={tz}>
                {friendlyTimezoneName(tz)}
              </option>
            ))}
          </select>
        </Field>
      </Card>

      <Card>
        <Field
          label="Token allocation"
          hint="Every member starts with this many tokens, both when they join and again at the start of each season."
        >
          <input name="seedAmount" type="number" min={1} defaultValue={1000} required className={inputClasses} />
        </Field>
      </Card>

      <Card className="space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="font-semibold text-espresso-800">Seasons</h3>
            <p className="text-sm text-espresso-500">
              Seasons reset everyone's balance and crown a champion. Leave this off to just let the economy run
              forever.
            </p>
          </div>
          <Switch checked={seasonsEnabled} onChange={() => setSeasonsEnabled((v) => !v)} />
        </div>

        {seasonsEnabled && (
          <div className="space-y-1.5 border-t border-espresso-100 pt-4">
            <label className="block font-semibold text-espresso-800">Season length</label>
            <div className="flex flex-wrap gap-2">
              {(['1m', '2m', '3m', 'manual'] as SeasonLength[]).map((len) => (
                <button
                  type="button"
                  key={len}
                  onClick={() => setSeasonLength(len)}
                  className={`rounded-full border px-4 py-1.5 text-sm font-semibold ${
                    seasonLength === len
                      ? 'border-honey-500 bg-honey-50 text-honey-800'
                      : 'border-espresso-200 text-espresso-600'
                  }`}
                >
                  {formatSeasonLength(len)}
                </button>
              ))}
            </div>
          </div>
        )}
      </Card>

      <Button type="submit" disabled={isPending} className="w-full" size="lg">
        {isPending ? 'Creating…' : 'Create group'}
      </Button>
    </form>
  );
}
