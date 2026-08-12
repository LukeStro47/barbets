'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createGroup, updateGroupSettings, setGroupAvatar } from '@/lib/actions/groups';
import { nameActiveSeason } from '@/lib/actions/seasons';
import { Switch } from '@/components/ui/Switch';
import { CaretLeftIcon, CaretDownIcon, CheckIcon, ClockIcon, PencilIcon } from '@/components/ui/icons';
import { GROUP_AVATARS } from '@/lib/avatars';
import { SEASON_LENGTH_SHORT_LABEL, SEASON_LENGTH_HINTS, type SeasonLength } from '@/lib/seasonLength';
import { COMMON_TIMEZONES, friendlyTimezoneName } from '@/lib/timezone';
import { formatTokens, formatTokenInputValue } from '@/lib/formatNumber';
import { GROUP_NAME_MAX_LENGTH, SEASON_NAME_MAX_LENGTH, TOKEN_ALLOCATION_MAX } from '@/lib/limits';
import { JUST_JOINED_GROUP_KEY } from '@/components/pwa/PushReminderModal';
import { cn } from '@/lib/cn';

const SEASON_LENGTHS: SeasonLength[] = ['1m', '2m', '3m', 'manual', 'custom'];

/** The one-or-two sentence form of a length's explanation, shown inside the locked-in card. The
 * full hints in lib/seasonLength.ts are written for a list where every option is visible at once
 * and needs distinguishing from its neighbours; here only the chosen one is on screen, so the
 * comparison clause is dropped. */
const SEASON_LENGTH_SUMMARY: Record<SeasonLength, string> = {
  '1m': 'A short run that refreshes often. Good for a fast-moving group that wants frequent fresh starts, like a monthly pickup league.',
  '2m': 'A couple of months of play between resets. Long enough for standings to matter, short enough to keep moving.',
  '3m': 'Long enough to feel like a real summer or semester. Works well for something tied to a real season, like a sports league or a school term.',
  manual: "Runs until you end it yourself, no clock. Good for a laid-back group that doesn't want a deadline hanging over it.",
  custom: 'Ends on the exact day and time you pick. Good for a single weekend, a summer with a specific end, or a one-night event.',
};

const cardClasses = 'rounded-[20px] border border-espresso-100 bg-paper-white p-4';
const footerButtonClasses =
  'flex h-[52px] w-full items-center justify-center rounded-full border-0 bg-espresso-800 text-[15px] font-extrabold text-paper-white disabled:opacity-45';

/** datetime-local wants "YYYY-MM-DDTHH:mm" in the browser's local time, not UTC. */
function toLocalDatetimeInputValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Back caret, progress pills, step counter — the only chrome the wizard steps carry, in place of
 * a page title they'd otherwise repeat under the heading. `backLabel` names the destination on the
 * step where leaving the flow is what "back" means; deeper in, the caret alone is unambiguous. */
function StepBar({
  step,
  total,
  label,
  backLabel,
  onBack,
}: {
  step: number;
  total: number;
  label: string;
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
        {Array.from({ length: total }, (_, i) => (
          <span key={i} className={cn('h-1 flex-1 rounded-full', i < step ? 'bg-honey-500' : 'bg-espresso-100')} />
        ))}
      </span>
      <span className="text-[11px] font-extrabold tracking-[0.06em] text-espresso-400 uppercase">{label}</span>
    </div>
  );
}

/** One hairline-divided house rule in the advanced view. `children` is whatever the rule needs
 * once it's on — only the payout split has any, and it stays mounted-on-demand rather than opening
 * a second screen. */
function ToggleRow({
  label,
  description,
  checked,
  onChange,
  last,
  children,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: () => void;
  last?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div className={cn('py-3.5', !last && 'border-b border-espresso-100')}>
      <div className="flex items-start gap-3">
        <span className="min-w-0 flex-1">
          <span className="block text-[13.5px] font-extrabold text-espresso-800">{label}</span>
          <span className="mt-0.5 block text-[11.5px] leading-[1.45] text-espresso-400">{description}</span>
        </span>
        <Switch checked={checked} onChange={onChange} />
      </div>
      {checked && children}
    </div>
  );
}

function SectionCard({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className={cardClasses}>
      <p className="text-[13px] font-extrabold text-espresso-800">{title}</p>
      {hint && <p className="mt-0.5 text-[11.5px] text-espresso-400">{hint}</p>}
      {children}
    </div>
  );
}

export function CreateGroupForm({ initialName, initialSeedAmount }: { initialName?: string; initialSeedAmount?: number } = {}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const [view, setView] = useState<'wizard' | 'advanced'>('wizard');
  const [step, setStep] = useState<1 | 2>(1);

  // Carried in from the bottom nav's drawer, which already asked for both. Editable here rather
  // than only there, so "wrong name" doesn't mean backing all the way out of the flow — the Edit
  // pill on the ticket reopens the same two fields as a sheet.
  const [name, setName] = useState(initialName ?? '');
  const [seedAmount, setSeedAmount] = useState(formatTokenInputValue(String(initialSeedAmount ?? 1000), TOKEN_ALLOCATION_MAX));
  // Open from the start only when the drawer didn't supply a name (a direct link to /groups/new),
  // so the flow never shows a ticket for a group with no name and no obvious way to give it one.
  const [editingTicket, setEditingTicket] = useState(!initialName);

  const [avatarKey, setAvatarKey] = useState<string>(GROUP_AVATARS[0].key);
  const [nickname, setNickname] = useState('');

  const [seasonsEnabled, setSeasonsEnabled] = useState(false);
  // Null, not 'manual': a preselected length is a length nobody chose, and 'manual' quietly
  // becomes the answer for anyone who turns seasons on and scrolls past the list.
  const [seasonLength, setSeasonLength] = useState<SeasonLength | null>(null);
  // Picking a length locks it, which collapses the list to one card; Cancel reopens the list with
  // the previous choice intact, so this stays separate from `seasonLength` being set.
  const [seasonLocked, setSeasonLocked] = useState(false);
  const [seasonName, setSeasonName] = useState('');
  const [seasonCustomEndsAt, setSeasonCustomEndsAt] = useState(() =>
    toLocalDatetimeInputValue(new Date(Date.now() + 24 * 60 * 60_000))
  );
  const [minSeasonEndsAt] = useState(() => toLocalDatetimeInputValue(new Date(Date.now() + 60_000)));

  // Starts at 'UTC' (matches server render) then snaps to the browser's own zone once mounted —
  // detecting it during the initial render would read the server's time zone during SSR and
  // mismatch on hydration.
  const [timezone, setTimezone] = useState('UTC');
  useEffect(() => {
    try {
      setTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone);
    } catch {
      // stays 'UTC'
    }
  }, []);

  // Advanced settings — every one of these is independently editable later via Settings, so
  // create_group() doesn't need to know about them at all: on success we just fire a follow-up
  // updateGroupSettings() call with whatever was chosen here. Three of these start-here defaults
  // deliberately diverge from group_settings' own column defaults (see
  // supabase/migrations/*_group_settings*.sql): requireEndorsement off (DB default: on) so a
  // brand-new market doesn't wait on a second approver, allowHedgedBets off (DB default: on)
  // since a fresh, small group hasn't opted into that risk yet, and resolutionWindowHours 2h (DB
  // default: 8h) for a snappier first few resolutions. creatorPayoutPct keeps the DB default and
  // has no control here — it only means anything once "Keep universal losses" is on, and asking
  // for a split percentage while starting a group is a question ahead of its own answer.
  const [requireEndorsement, setRequireEndorsement] = useState(false);
  const [allowHedgedBets, setAllowHedgedBets] = useState(false);
  const [distributePayout, setDistributePayout] = useState(false);
  const [creatorPayoutPct, setCreatorPayoutPct] = useState(25);
  const [resolutionWindowHours, setResolutionWindowHours] = useState(2);

  const creatorPctValid = Number.isFinite(creatorPayoutPct) && creatorPayoutPct >= 0 && creatorPayoutPct <= 100;

  // Each view is its own screenful, so arriving at one part-scrolled (the browser restoring the
  // last position, or a focused field pulling the page down) hides the step bar that says where
  // you are. Reset on every step/view change, including the first paint after the drawer's push.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [step, view]);

  const seedAmountNumber = Number(seedAmount.replace(/,/g, ''));
  const step1Valid = name.trim().length > 0 && nickname.trim().length > 0 && seedAmountNumber > 0;
  // With no length preselected, turning seasons on is only half an answer — the group can't be
  // created until the second half is given.
  const step2Valid = creatorPctValid && (!seasonsEnabled || seasonLength !== null);

  function handleCreate() {
    setError(null);
    startTransition(async () => {
      const result = await createGroup({
        name: name.trim(),
        seedAmount: seedAmountNumber,
        seasonsEnabled,
        seasonLength: seasonsEnabled ? seasonLength : null,
        seasonCustomEndsAt: seasonsEnabled && seasonLength === 'custom' ? new Date(seasonCustomEndsAt).toISOString() : null,
        nickname: nickname.trim(),
        timezone,
      });
      if (result.error) {
        setError(result.error);
        return;
      }
      const groupId = result.data!.id;

      // Best-effort from here down: the group already exists, and every one of these stays
      // editable from Settings, so a failure shouldn't block navigation the way a real
      // createGroup() failure does.
      await Promise.all([
        updateGroupSettings(groupId, {
          seedAmount: seedAmountNumber,
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
        }),
        setGroupAvatar(groupId, avatarKey),
        seasonsEnabled && seasonName.trim() ? nameActiveSeason(groupId, seasonName.trim()) : Promise.resolve(),
      ]);

      localStorage.setItem(JUST_JOINED_GROUP_KEY, '1');
      router.push(`/groups/${groupId}`);
    });
  }

  /** The drawer's answers, carried through the flow as the thing being built rather than re-asked
   * as two more fields. Same block on both steps so the group being made never leaves the top of
   * the screen; step 2 folds in the picture and nickname, which exist by then. */
  const ticket = (withIdentity: boolean) => (
    <div className="flex items-center gap-3 rounded-[18px] bg-gradient-to-br from-espresso-900 to-espresso-700 px-4 py-3.5">
      {withIdentity && (
        <img src={`/avatars/${avatarKey}.png`} alt="" className="h-[38px] w-[38px] shrink-0 rounded-full object-cover" />
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate font-display text-[16.5px] font-extrabold tracking-[-0.015em] text-paper-white">
          {name || 'Your group'}
        </span>
        <span className="mt-0.5 block text-xs text-paper-white/55">
          {withIdentity && nickname.trim() ? `@${nickname.trim()} · ` : ''}
          {formatTokens(seedAmountNumber || 0)} tokens each
        </span>
      </span>
      <button
        type="button"
        onClick={() => setEditingTicket((v) => !v)}
        className="flex shrink-0 items-center gap-1.5 rounded-full border-0 bg-paper-white/12 px-[13px] py-[7px]"
      >
        <PencilIcon className="h-[13px] w-[13px] text-honey-300" />
        <span className="text-[11.5px] font-extrabold text-honey-300">Edit</span>
      </button>
    </div>
  );

  const ticketEditor = editingTicket && (
    <div className="flex flex-col gap-2 rounded-[18px] border border-espresso-100 bg-paper-white p-4">
      <label className="block">
        <span className="block text-[10px] font-bold tracking-[0.07em] text-espresso-400 uppercase">Group name</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={GROUP_NAME_MAX_LENGTH}
          placeholder="The Wednesday Wagers"
          className="mt-1 block w-full rounded-xl border border-espresso-200 bg-paper-white px-3 py-2.5 text-sm font-bold text-espresso-950 focus:border-honey-500 focus:outline-none"
        />
      </label>
      <label className="block">
        <span className="block text-[10px] font-bold tracking-[0.07em] text-espresso-400 uppercase">Token allocation</span>
        <input
          type="text"
          inputMode="numeric"
          value={seedAmount}
          onChange={(e) => setSeedAmount(formatTokenInputValue(e.target.value, TOKEN_ALLOCATION_MAX))}
          className="mt-1 block w-full rounded-xl border border-espresso-200 bg-paper-white px-3 py-2.5 text-sm font-bold text-espresso-950 focus:border-honey-500 focus:outline-none"
        />
      </label>
    </div>
  );

  if (view === 'advanced') {
    return (
      <div className="flex flex-1 flex-col gap-[15px]">
        <button
          type="button"
          onClick={() => setView('wizard')}
          className="-ml-1 inline-flex items-center gap-0.5 self-start border-0 bg-transparent p-0 text-[12.5px] font-bold text-espresso-400"
        >
          <CaretLeftIcon className="h-4 w-4 text-espresso-300" />
          Step 2
        </button>

        <div>
          <h1 className="font-display text-[26px] font-extrabold tracking-[-0.02em] text-espresso-950">Advanced settings</h1>
          <p className="mt-1.5 text-[13px] leading-[1.5] text-espresso-500">
            Defaults suit a small group. All of it stays editable later.
          </p>
        </div>

        <div className="rounded-[20px] border border-espresso-100 bg-paper-white px-4">
          <ToggleRow
            label="Second pair of eyes"
            description="Someone else endorses a market before betting opens."
            checked={requireEndorsement}
            onChange={() => setRequireEndorsement((v) => !v)}
          />
          <ToggleRow
            label="Hedging"
            description="Members can bet on more than one side or option of the same market."
            checked={allowHedgedBets}
            onChange={() => setAllowHedgedBets((v) => !v)}
          />
          <ToggleRow
            label="Split universal losses"
            description="When everyone loses, split the pool instead of refunding everyone."
            checked={distributePayout}
            onChange={() => setDistributePayout((v) => !v)}
            last
          >
            {/* Only one number is actually a choice. What's left over is arithmetic, so it's shown
                rather than asked for — same split the group's own Settings page uses, since this
                is the same setting seen a few minutes earlier. */}
            <div className="mt-3 flex gap-3">
              <label className="flex-1">
                <span className="block text-[11px] font-bold text-espresso-500">Creator %</span>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={creatorPayoutPct}
                  onChange={(e) => setCreatorPayoutPct(Number(e.target.value))}
                  className="mt-1 block w-full rounded-xl border border-espresso-200 bg-paper-white px-3 py-2.5 text-sm font-bold text-espresso-950 focus:border-honey-500 focus:outline-none"
                />
              </label>
              <div className="flex-1">
                <span className="block text-[11px] font-bold text-espresso-500">Open markets %</span>
                <div
                  aria-readonly
                  className="mt-1 w-full rounded-xl border border-espresso-100 bg-espresso-50 px-3 py-2.5 text-sm font-bold text-espresso-500"
                >
                  {creatorPctValid ? 100 - creatorPayoutPct : '—'}
                </div>
              </div>
            </div>
            <p className="mt-2 text-[11.5px] leading-[1.45] text-espresso-400">
              Whatever the creator doesn't take is split across the group's other open markets, or held for the next
              market if there aren't any.
            </p>
            {!creatorPctValid && (
              <p className="mt-1.5 text-[11.5px] text-danger-700">The creator percentage has to be between 0 and 100.</p>
            )}
          </ToggleRow>
        </div>

        <div className={cardClasses}>
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-[13.5px] font-extrabold text-espresso-800">Time to challenge a result</span>
            <span className="shrink-0 text-sm font-extrabold tabular-nums text-honey-700">
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
            className="mt-3.5 w-full accent-honey-500"
          />
          <div className="mt-2 flex justify-between text-[11px] text-espresso-400">
            <span>30 min</span>
            <span>10 hours</span>
          </div>
          <p className="mt-2.5 text-[11.5px] leading-[1.45] text-espresso-400">
            How long the group has to dispute a proposed outcome, and to vote on one that is disputed.
          </p>
        </div>

        <div className="mt-auto pt-6">
          <button type="button" disabled={!creatorPctValid} onClick={() => setView('wizard')} className={footerButtonClasses}>
            Done
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-4">
      {error && <p className="text-sm text-danger-700">{error}</p>}

      {step === 1 ? (
        <>
          <StepBar step={1} total={2} label="1 of 2" backLabel="All groups" onBack={() => router.push('/groups?all=1')} />

          {ticket(false)}
          {ticketEditor}

          <div>
            <h1 className="font-display text-[28px] leading-[1.1] font-extrabold tracking-[-0.025em] text-espresso-950">
              Who's at this table?
            </h1>
            <p className="mt-2 text-[13.5px] leading-[1.5] text-espresso-500">
              A picture for the group and a name for you. That's step one.
            </p>
          </div>

          <SectionCard title="Group picture">
            <div className="mt-3 flex flex-wrap gap-2">
              {GROUP_AVATARS.map((a) => (
                <button
                  key={a.key}
                  type="button"
                  onClick={() => setAvatarKey(a.key)}
                  aria-pressed={avatarKey === a.key}
                  title={a.label}
                  className={cn(
                    'h-11 w-11 shrink-0 overflow-hidden rounded-full bg-transparent p-0',
                    avatarKey === a.key ? 'border-2 border-honey-500' : 'border border-espresso-100 opacity-90'
                  )}
                >
                  <img src={`/avatars/${a.key}.png`} alt={a.label} className="h-full w-full object-cover" />
                </button>
              ))}
            </div>
            <p className="mt-2.5 text-[11.5px] text-espresso-400">Pick the one that fits the group.</p>
          </SectionCard>

          <SectionCard title="Your nickname here" hint="One word. This is how you get @mentioned.">
            <div className="mt-2.5 flex items-center gap-1 rounded-[14px] border-[1.5px] border-honey-500 px-[15px] py-3">
              <span className="text-xl font-extrabold text-honey-700">@</span>
              <input
                value={nickname}
                onChange={(e) => setNickname(e.target.value.toLowerCase())}
                maxLength={20}
                placeholder="dan"
                className="min-w-0 flex-1 border-0 bg-transparent p-0 text-xl font-extrabold tracking-[-0.01em] text-espresso-950 placeholder:text-espresso-200 focus:outline-none"
              />
            </div>
          </SectionCard>

          <div className="mt-auto flex flex-col gap-2.5 pt-6">
            <button type="button" disabled={!step1Valid} onClick={() => setStep(2)} className={footerButtonClasses}>
              Next
            </button>
            <p className="text-center text-xs text-espresso-400">Seasons and time zone come next.</p>
          </div>
        </>
      ) : (
        <>
          <StepBar step={2} total={2} label="2 of 2" onBack={() => setStep(1)} />
          {ticket(true)}
          {ticketEditor}

          <h1 className="font-display text-[28px] leading-[1.1] font-extrabold tracking-[-0.025em] text-espresso-950">
            How should it run?
          </h1>

          <div className={cardClasses}>
            <div className="flex items-start gap-3">
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-extrabold text-espresso-800">Run it in seasons</span>
                <span className="mt-0.5 block text-[11.5px] leading-[1.45] text-espresso-400">
                  Balances reset, a champion gets crowned. Off means the group runs indefinitely.
                </span>
              </span>
              <Switch checked={seasonsEnabled} onChange={() => setSeasonsEnabled((v) => !v)} />
            </div>

            {seasonsEnabled && (
              <div className="mt-3 border-t border-espresso-100 pt-3">
                {!(seasonLocked && seasonLength) ? (
                  <div className="flex flex-col gap-1.5">
                    {SEASON_LENGTHS.map((len) => {
                      const on = seasonLength === len;
                      return (
                        <button
                          key={len}
                          type="button"
                          onClick={() => {
                            setSeasonLength(len);
                            setSeasonLocked(true);
                          }}
                          className={cn(
                            'flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-left',
                            on ? 'border-[1.5px] border-honey-500 bg-honey-50' : 'border border-espresso-100 bg-transparent'
                          )}
                        >
                          <span
                            className={cn(
                              'h-3.5 w-3.5 shrink-0 rounded-full bg-paper-white',
                              on ? 'border-4 border-honey-500' : 'border-[1.5px] border-espresso-200'
                            )}
                          />
                          <span className={cn('text-[13px] font-extrabold', on ? 'text-honey-800' : 'text-espresso-800')}>
                            {SEASON_LENGTH_SHORT_LABEL[len]}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="rounded-[14px] border-[1.5px] border-honey-500 bg-honey-50 px-3.5 py-3">
                    <div className="flex items-center gap-2.5">
                      <CheckIcon className="h-4 w-4 shrink-0 text-honey-800" />
                      <span className="min-w-0 flex-1 text-[14.5px] font-extrabold text-honey-800">
                        {SEASON_LENGTH_SHORT_LABEL[seasonLength]}
                      </span>
                      <button
                        type="button"
                        onClick={() => setSeasonLocked(false)}
                        className="shrink-0 border-0 border-b border-honey-800/40 bg-transparent p-0 text-[11.5px] font-extrabold text-honey-900"
                      >
                        Cancel
                      </button>
                    </div>
                    <p className="mt-2.5 text-xs leading-[1.45] text-honey-900">{SEASON_LENGTH_SUMMARY[seasonLength]}</p>

                    {seasonLength === 'custom' && (
                      <input
                        type="datetime-local"
                        min={minSeasonEndsAt}
                        value={seasonCustomEndsAt}
                        onChange={(e) => setSeasonCustomEndsAt(e.target.value)}
                        required
                        className="mt-2.5 w-full rounded-xl border-[1.5px] border-honey-500 bg-paper-white px-3 py-2.5 text-[13px] font-bold text-espresso-950 focus:outline-none"
                      />
                    )}

                    <div className="mt-3 border-t border-honey-800/20 pt-3">
                      <span className="block text-[10.5px] font-extrabold tracking-[0.08em] text-honey-800 uppercase">
                        Name this season
                      </span>
                      <input
                        value={seasonName}
                        onChange={(e) => setSeasonName(e.target.value)}
                        maxLength={SEASON_NAME_MAX_LENGTH}
                        placeholder="The August Run"
                        className="mt-[7px] w-full rounded-xl border-[1.5px] border-honey-500 bg-paper-white px-3 py-2.5 text-[14.5px] font-bold text-espresso-950 placeholder:text-espresso-200 focus:outline-none"
                      />
                      <span className="mt-[7px] block text-[11px] text-honey-900">
                        Optional. We'll call it Season 1 otherwise.
                      </span>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          <SectionCard title="Time zone" hint="Shown next to every closing time.">
            <div className="relative mt-2.5 flex items-center gap-2.5 rounded-[14px] border border-espresso-200 px-[15px] py-3">
              <ClockIcon className="h-[17px] w-[17px] shrink-0 text-espresso-500" />
              <span className="min-w-0 flex-1 truncate text-[14.5px] font-bold text-espresso-950">
                {friendlyTimezoneName(timezone)}
              </span>
              <CaretDownIcon className="h-[15px] w-[15px] shrink-0 text-espresso-400" />
              <select
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                aria-label="Time zone"
                className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
              >
                {!(COMMON_TIMEZONES as readonly string[]).includes(timezone) && (
                  <option value={timezone}>{friendlyTimezoneName(timezone)}</option>
                )}
                {COMMON_TIMEZONES.map((tz) => (
                  <option key={tz} value={tz}>
                    {friendlyTimezoneName(tz)}
                  </option>
                ))}
              </select>
            </div>
            <p className="mt-2 text-[11.5px] text-espresso-400">Matched to this phone.</p>
          </SectionCard>

          {/* Label only, no preview of what's inside: the whole point of the row is that nobody
              starting a group has to have an opinion on any of it. */}
          <button
            type="button"
            onClick={() => setView('advanced')}
            className="flex items-center justify-between rounded-[18px] border border-espresso-100 bg-paper-white px-4 py-3.5"
          >
            <span className="text-[13px] font-extrabold text-espresso-700">Advanced settings</span>
            <CaretDownIcon className="h-[15px] w-[15px] text-espresso-400 -rotate-90" />
          </button>

          <div className="mt-auto pt-6">
            <button type="button" disabled={isPending || !step2Valid} onClick={handleCreate} className={footerButtonClasses}>
              {isPending ? 'Creating…' : 'Create group'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
