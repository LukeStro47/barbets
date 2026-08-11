'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createGroup, updateGroupSettings } from '@/lib/actions/groups';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Switch } from '@/components/ui/Switch';
import { JUST_JOINED_GROUP_KEY } from '@/components/pwa/PushReminderModal';
import { formatSeasonLength, SEASON_LENGTH_HINTS, type SeasonLength } from '@/lib/seasonLength';
import { COMMON_TIMEZONES, friendlyTimezoneName } from '@/lib/timezone';
import { formatTokenInputValue } from '@/lib/formatNumber';
import { GROUP_NAME_MAX_LENGTH } from '@/lib/limits';

const inputClasses =
  'w-full rounded-xl border border-espresso-200 bg-paper-white px-4 py-2.5 text-espresso-900 focus:border-honey-500 focus:outline-none focus:ring-2 focus:ring-honey-200';

/** datetime-local wants "YYYY-MM-DDTHH:mm" in the browser's local time, not UTC. */
function toLocalDatetimeInputValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function Field({ label, hint, children }: { label: string; hint: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="block font-semibold text-espresso-800">{label}</label>
      <p className="text-sm text-espresso-500">{hint}</p>
      {children}
    </div>
  );
}

export function CreateGroupForm({ initialName, initialSeedAmount }: { initialName?: string; initialSeedAmount?: number } = {}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [seasonsEnabled, setSeasonsEnabled] = useState(false);
  const [seasonLength, setSeasonLength] = useState<SeasonLength>('manual');
  const [seasonCustomEndsAt, setSeasonCustomEndsAt] = useState(() =>
    toLocalDatetimeInputValue(new Date(Date.now() + 24 * 60 * 60_000))
  );
  const [minSeasonEndsAt] = useState(() => toLocalDatetimeInputValue(new Date(Date.now() + 60_000)));
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

  // Advanced settings — every one of these is independently editable later via
  // Settings, so create_group() doesn't need to know about them at all: on
  // success we just fire a follow-up updateGroupSettings() call with whatever
  // was chosen here. Three of these start-here defaults deliberately diverge
  // from group_settings' own column defaults (see
  // supabase/migrations/*_group_settings*.sql): requireEndorsement off (DB
  // default: on) so a brand-new market doesn't wait on a second approver,
  // allowHedgedBets off (DB default: on) since a fresh, small group hasn't
  // opted into that risk yet, and resolutionWindowHours 2h (DB default: 8h)
  // for a snappier first few resolutions. distributePayout/creatorPayoutPct
  // match the DB defaults as-is.
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [requireEndorsement, setRequireEndorsement] = useState(false);
  const [allowHedgedBets, setAllowHedgedBets] = useState(false);
  const [distributePayout, setDistributePayout] = useState(false);
  const [creatorPayoutPct, setCreatorPayoutPct] = useState(25);
  const [resolutionWindowHours, setResolutionWindowHours] = useState(2);

  const creatorPctValid = Number.isFinite(creatorPayoutPct) && creatorPayoutPct >= 0 && creatorPayoutPct <= 100;

  function handleSubmit(formData: FormData) {
    setError(null);
    const seedAmount = Number(String(formData.get('seedAmount')).replace(/,/g, ''));
    startTransition(async () => {
      const result = await createGroup({
        name: String(formData.get('name')),
        seedAmount,
        seasonsEnabled,
        seasonLength: seasonsEnabled ? seasonLength : null,
        seasonCustomEndsAt: seasonsEnabled && seasonLength === 'custom' ? new Date(seasonCustomEndsAt).toISOString() : null,
        nickname: String(formData.get('nickname')).trim(),
        timezone,
      });
      if (result.error) {
        setError(result.error);
        return;
      }

      // Best-effort: the group already exists at this point, and every one of
      // these stays editable from Settings, so a failure here shouldn't block
      // navigation the way a real createGroup() failure does.
      await updateGroupSettings(result.data!.id, {
        seedAmount,
        seasonsEnabled,
        seasonLength: seasonsEnabled ? seasonLength : null,
        seasonCustomEndsAt: seasonsEnabled && seasonLength === 'custom' ? new Date(seasonCustomEndsAt).toISOString() : null,
        timezone,
        bettingEnabled: false,
        acceptingMembers: true,
        distributePayout,
        creatorPayoutPct,
        allowHedgedBets,
        resolutionWindowHours,
        requireEndorsement,
      });

      localStorage.setItem(JUST_JOINED_GROUP_KEY, '1');
      router.push(`/groups/${result.data!.id}`);
    });
  }

  return (
    <form action={handleSubmit} className="space-y-5">
      {error && <p className="text-sm text-danger-700">{error}</p>}

      <Card className="space-y-4">
        <Field label="Group name" hint="What your friends will see when they get the invite.">
          <input
            name="name"
            placeholder="The Wednesday Wagers"
            defaultValue={initialName}
            required
            maxLength={GROUP_NAME_MAX_LENGTH}
            className={inputClasses}
          />
        </Field>

        <div className="border-t border-espresso-100 pt-4">
          <Field
            label="Token allocation"
            hint="Every member starts with this many tokens, both when they join and again at the start of each season."
          >
            <input
              name="seedAmount"
              type="text"
              inputMode="numeric"
              defaultValue={formatTokenInputValue(String(initialSeedAmount ?? 1000))}
              onChange={(e) => {
                const formatted = formatTokenInputValue(e.target.value);
                if (formatted !== e.target.value) e.target.value = formatted;
              }}
              required
              className={inputClasses}
            />
          </Field>
        </div>

        <div className="border-t border-espresso-100 pt-4">
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
        </div>

        <div className="border-t border-espresso-100 pt-4">
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
        </div>

        <div className="border-t border-espresso-100 pt-4">
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
            <div className="space-y-1.5 border-t border-espresso-100 mt-4 pt-4">
              <label className="block font-semibold text-espresso-800">Season length</label>
              <div className="flex flex-wrap gap-2">
                {(['1m', '2m', '3m', 'manual', 'custom'] as SeasonLength[]).map((len) => (
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
              <p className="text-xs text-espresso-400">{SEASON_LENGTH_HINTS[seasonLength]}</p>

              {seasonLength === 'custom' && (
                <input
                  type="datetime-local"
                  min={minSeasonEndsAt}
                  value={seasonCustomEndsAt}
                  onChange={(e) => setSeasonCustomEndsAt(e.target.value)}
                  required
                  className={`${inputClasses} mt-1`}
                />
              )}
            </div>
          )}
        </div>
      </Card>

      <Card className="space-y-4">
        <button
          type="button"
          onClick={() => setShowAdvanced((v) => !v)}
          className="flex w-full items-center justify-between text-left"
        >
          <div>
            <h3 className="font-semibold text-espresso-800">Advanced settings</h3>
            <p className="text-sm text-espresso-500">
              Optional house rules. Everything here can also be changed later from Settings.
            </p>
          </div>
          <span className={`text-espresso-400 transition-transform ${showAdvanced ? 'rotate-180' : ''}`}>▾</span>
        </button>

        {showAdvanced && (
          <div className="space-y-4 border-t border-espresso-100 pt-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-semibold text-espresso-700">Require endorsement</p>
                <p className="text-xs text-espresso-400">
                  {requireEndorsement
                    ? "A second member has to endorse a market before it opens for betting. Turn this off for a small, high-trust group where waiting on someone else to endorse is just friction, not a real check on anyone."
                    : "Markets open for betting the moment they're created, no second person needed. Recommended to start, most new groups are small enough that this isn't a real check."}
                </p>
              </div>
              <Switch checked={requireEndorsement} onChange={() => setRequireEndorsement((v) => !v)} />
            </div>

            <div className="space-y-2 border-t border-espresso-100 pt-4">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-semibold text-espresso-700">Split universal losses</p>
                  <p className="text-xs text-espresso-400">
                    {distributePayout
                      ? "When everyone loses in a market, split that pool between the creator and the group's other open markets instead of refunding it."
                      : 'Off by default: when everyone loses in a market, everyone gets their stake back.'}
                  </p>
                </div>
                <Switch checked={distributePayout} onChange={() => setDistributePayout((v) => !v)} />
              </div>

              {distributePayout && (
                <div className="flex gap-3 pt-1">
                  <label className="flex-1 space-y-1">
                    <span className="text-xs font-semibold text-espresso-500">Creator %</span>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={creatorPayoutPct}
                      onChange={(e) => setCreatorPayoutPct(Number(e.target.value))}
                      className={inputClasses}
                    />
                  </label>
                  <div className="flex-1 space-y-1">
                    <span className="block text-xs font-semibold text-espresso-500">Open markets %</span>
                    <div
                      aria-readonly
                      className="w-full rounded-xl border border-espresso-100 bg-espresso-50 px-4 py-2.5 font-semibold text-espresso-500"
                    >
                      {creatorPctValid ? 100 - creatorPayoutPct : '—'}
                    </div>
                  </div>
                </div>
              )}
              {distributePayout && !creatorPctValid && (
                <p className="text-xs text-danger-700">The creator percentage has to be between 0 and 100.</p>
              )}
            </div>

            <div className="flex items-center justify-between gap-4 border-t border-espresso-100 pt-4">
              <div>
                <p className="text-sm font-semibold text-espresso-700">Hedging</p>
                <p className="text-xs text-espresso-400">
                  {allowHedgedBets
                    ? 'Members can bet on more than one side or option of the same market.'
                    : "Members can only hold a bet on one side per market. Adding more to that same side is still fine."}
                </p>
              </div>
              <Switch checked={allowHedgedBets} onChange={() => setAllowHedgedBets((v) => !v)} />
            </div>

            <div className="space-y-1.5 border-t border-espresso-100 pt-4">
              <div className="flex items-center justify-between">
                <label className="text-sm font-semibold text-espresso-700">Challenge/resolution window</label>
                <span className="font-display text-sm font-bold text-honey-700">
                  {resolutionWindowHours} {resolutionWindowHours === 1 ? 'hour' : 'hours'}
                </span>
              </div>
              <input
                type="range"
                min={0.5}
                max={10}
                step={0.5}
                value={resolutionWindowHours}
                onChange={(e) => setResolutionWindowHours(Number(e.target.value))}
                className="w-full accent-honey-500"
              />
              <p className="text-xs text-espresso-400">
                How long a proposed resolution can be challenged, and how long a challenged one stays open for voting. We
                recommend at least 2 hours so people have a real chance to weigh in.
              </p>
            </div>
          </div>
        )}
      </Card>

      <Button
        type="submit"
        disabled={isPending || (distributePayout && !creatorPctValid)}
        className="w-full"
        size="lg"
      >
        {isPending ? 'Creating…' : 'Create group'}
      </Button>
    </form>
  );
}
