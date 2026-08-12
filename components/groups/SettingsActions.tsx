'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { regenerateInviteCode, removeMember, transferOwnership, deleteGroup, updateGroupSettings } from '@/lib/actions/groups';
import { endSeason } from '@/lib/actions/seasons';
import { Button } from '@/components/ui/Button';
import { Switch } from '@/components/ui/Switch';
import { Modal } from '@/components/ui/Modal';
import { ConsequenceRow } from '@/components/ui/ConsequenceRow';
import { SectionLabel, SettingsCard, NavRowContent, settingsNavRowClasses } from '@/components/ui/SettingsList';
import { AlertTriangleIcon, LockIcon } from '@/components/ui/icons';
import { SeasonNameEditor } from '@/components/groups/SeasonNameEditor';
import { SEASON_LENGTH_HINTS, SEASON_LENGTH_SHORT_LABEL, type SeasonLength } from '@/lib/seasonLength';
import { COMMON_TIMEZONES, friendlyTimezoneName } from '@/lib/timezone';
import { Mention } from '@/components/ui/Mention';
import { formatTokens, formatTokenInputValue } from '@/lib/formatNumber';
import { TOKEN_ALLOCATION_MAX } from '@/lib/limits';
import type { GroupSettings } from '@/lib/actions/groups';

const inputClasses =
  'w-full rounded-[10px] border border-espresso-200 bg-paper-white px-3.5 py-2.5 text-[15px] font-bold text-espresso-950 focus:border-honey-500 focus:outline-none focus:ring-2 focus:ring-honey-200';

const selectClasses =
  'w-full rounded-[10px] border border-espresso-200 bg-paper-white px-3.5 py-2.5 text-[15px] font-semibold text-espresso-950 focus:border-honey-500 focus:outline-none focus:ring-2 focus:ring-honey-200';

const rowClasses = 'px-4 py-3.5';
const rowLabelClasses = 'block text-sm font-semibold text-espresso-800';
const rowHelpClasses = 'text-xs leading-[1.45] text-espresso-400';

/** datetime-local wants "YYYY-MM-DDTHH:mm" in the browser's local time, not UTC. */
function toLocalDatetimeInputValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** A toggle row: the setting, the sentence saying what the *current* position of the switch does, and the switch. */
function ToggleRow({
  label,
  help,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  help: React.ReactNode;
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
}) {
  return (
    <div className={`${rowClasses} flex items-start justify-between gap-3.5`}>
      <span className="min-w-0">
        <span className={rowLabelClasses}>{label}</span>
        <span className={`mt-0.5 block ${rowHelpClasses}`}>{help}</span>
      </span>
      <Switch checked={checked} onChange={onChange} disabled={disabled} className="mt-0.5" />
    </div>
  );
}

/**
 * The owner's edit view for how the group plays, at /groups/[groupId]/settings/edit.
 *
 * A separate screen rather than an expansion inside the settings list, and four labelled groups
 * rather than one flat column: the previous version dumped nine unrelated controls into a single
 * card, so "how much does everyone start with" sat directly above "how long is a challenge window"
 * with nothing saying they were different kinds of decision. No autosave — every change is a draft
 * until Save, which is what makes Cancel mean something.
 */
export function EditSettingsForm({
  groupId,
  groupName,
  settings,
}: {
  groupId: string;
  groupName: string;
  settings: GroupSettings;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [seedAmount, setSeedAmount] = useState(() => formatTokenInputValue(String(settings.seed_amount)));
  const [seasonsEnabled, setSeasonsEnabled] = useState(settings.seasons_enabled);
  const [seasonLength, setSeasonLength] = useState<SeasonLength>(settings.season_length ?? 'manual');
  const [seasonCustomEndsAt, setSeasonCustomEndsAt] = useState(() =>
    toLocalDatetimeInputValue(settings.season_custom_ends_at ? new Date(settings.season_custom_ends_at) : new Date(Date.now() + 24 * 60 * 60_000))
  );
  const [minSeasonEndsAt] = useState(() => toLocalDatetimeInputValue(new Date(Date.now() + 60_000)));
  const [timezone, setTimezone] = useState(settings.timezone);
  const [bettingEnabled, setBettingEnabled] = useState(settings.betting_enabled);
  const [confirmingBetting, setConfirmingBetting] = useState(false);
  const [acceptingMembers, setAcceptingMembers] = useState(settings.accepting_members);
  const [distributePayout, setDistributePayout] = useState(settings.distribute_payout);
  const [creatorPayoutPct, setCreatorPayoutPct] = useState(settings.creator_payout_pct);
  const [allowHedgedBets, setAllowHedgedBets] = useState(settings.allow_hedged_bets);
  const [resolutionWindowHours, setResolutionWindowHours] = useState(settings.resolution_window_hours);
  const [requireEndorsement, setRequireEndorsement] = useState(settings.require_endorsement);

  const creatorPctValid = Number.isFinite(creatorPayoutPct) && creatorPayoutPct >= 0 && creatorPayoutPct <= 100;
  const openMarketsPct = creatorPctValid ? 100 - creatorPayoutPct : '—';

  function back() {
    router.push(`/groups/${groupId}/settings`);
  }

  function save() {
    setError(null);
    startTransition(async () => {
      const result = await updateGroupSettings(groupId, {
        seedAmount: Number(seedAmount.replace(/,/g, '')),
        seasonsEnabled,
        seasonLength: seasonsEnabled ? seasonLength : null,
        seasonCustomEndsAt: seasonsEnabled && seasonLength === 'custom' ? new Date(seasonCustomEndsAt).toISOString() : null,
        timezone,
        bettingEnabled,
        acceptingMembers,
        distributePayout,
        creatorPayoutPct,
        allowHedgedBets,
        resolutionWindowHours,
        requireEndorsement,
      });
      if (result.error) {
        setError(result.error);
      } else {
        router.push(`/groups/${groupId}/settings`);
        router.refresh();
      }
    });
  }

  return (
    <>
      {/* The sticky bar is fixed, so the scrolling column has to reserve its height itself. */}
      <div className="flex flex-col gap-[22px] pb-24">
        <div>
          <p className="text-[12.5px] font-bold text-espresso-400">{groupName}</p>
          <h1 className="font-display text-2xl font-extrabold tracking-[-0.02em] text-espresso-950">How this group plays</h1>
          <p className="mt-1 text-[13px] leading-[1.5] text-espresso-500">
            Changes apply the moment you save. Members see the same list, read-only.
          </p>
        </div>

        {error && <p className="text-sm text-danger-700">{error}</p>}

        <section>
          <SectionLabel>Money</SectionLabel>
          <SettingsCard>
            <div className={rowClasses}>
              <label className={rowLabelClasses} htmlFor="seed-amount">
                Token allocation
              </label>
              <p className={`mb-2 mt-0.5 ${rowHelpClasses}`}>
                What each member starts with, up to {formatTokens(TOKEN_ALLOCATION_MAX)}. Never touches a current balance, it
                applies to people joining from now on{seasonsEnabled ? ', and to everyone at the next season.' : '.'}
              </p>
              <input
                id="seed-amount"
                type="text"
                inputMode="numeric"
                // Deliberately not clamped on mount: a group stored above the cap before it existed
                // keeps its figure here, so opening this form for an unrelated change and saving
                // doesn't quietly rewrite the allocation. Typing does clamp, and
                // update_group_settings only enforces the bound on a value that actually changed.
                value={seedAmount}
                onChange={(e) => setSeedAmount(formatTokenInputValue(e.target.value, TOKEN_ALLOCATION_MAX))}
                required
                className={inputClasses}
              />
            </div>

            <div>
              <ToggleRow
                label="Split universal losses"
                help={
                  distributePayout
                    ? "On: when nobody calls it right, the creator takes a cut and the rest tops up the group's other open markets."
                    : 'Off: when nobody calls it right, every stake goes back to whoever placed it.'
                }
                checked={distributePayout}
                onChange={() => setDistributePayout((v) => !v)}
              />
              {/* Only one number is actually a choice. What's left over is arithmetic, so it's
                  shown rather than asked for: two editable fields could be set to sum past 100,
                  and the second one was never the interesting decision anyway. */}
              {distributePayout && (
                <div className="space-y-2 px-4 pb-3.5">
                  <div className="flex gap-3">
                    <label className="flex-1 space-y-1">
                      <span className="block text-xs font-bold text-espresso-500">Creator %</span>
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
                      <span className="block text-xs font-bold text-espresso-500">Open markets %</span>
                      <div
                        aria-readonly
                        className="w-full rounded-[10px] border border-espresso-100 bg-espresso-50 px-3.5 py-2.5 text-[15px] font-bold text-espresso-400"
                      >
                        {openMarketsPct}
                      </div>
                    </div>
                  </div>
                  {!creatorPctValid && <p className="text-xs text-danger-700">The creator percentage has to be between 0 and 100.</p>}
                </div>
              )}
            </div>
          </SettingsCard>
        </section>

        <section>
          <SectionLabel>Starting a market</SectionLabel>
          <SettingsCard>
            <ToggleRow
              label="Require endorsement"
              help={
                requireEndorsement
                  ? 'On: a second member has to endorse a market before betting opens.'
                  : "Off: markets open for betting the moment they're created, no second person needed."
              }
              checked={requireEndorsement}
              onChange={() => setRequireEndorsement((v) => !v)}
            />
            <ToggleRow
              label="Hedging"
              help={
                allowHedgedBets
                  ? 'On: members can back more than one side of the same market.'
                  : 'Off: one side per market. Adding more to that same side is still fine.'
              }
              checked={allowHedgedBets}
              onChange={() => setAllowHedgedBets((v) => !v)}
            />
            <ToggleRow
              label="Accepting new members"
              help={
                acceptingMembers
                  ? 'On: anyone holding the invite code can join.'
                  : 'Off: the invite code stays live but joining is paused.'
              }
              checked={acceptingMembers}
              onChange={() => setAcceptingMembers((v) => !v)}
            />
            {/* Only meaningful while seasons are off. Once they're on, each season carries its own
                betting switch and this one stops being the real gate. */}
            {!seasonsEnabled && (
              <ToggleRow
                label="Betting"
                help={
                  bettingEnabled
                    ? "On: members can start markets. This one can't be turned back off."
                    : 'Off by default. Turn it on when your group is ready.'
                }
                checked={bettingEnabled}
                onChange={() => {
                  if (!bettingEnabled) setConfirmingBetting(true);
                }}
                disabled={settings.betting_enabled}
              />
            )}
          </SettingsCard>
        </section>

        <section>
          <SectionLabel>Settling it</SectionLabel>
          <SettingsCard>
            <div className={rowClasses}>
              <div className="flex items-baseline justify-between gap-3">
                <label className="text-sm font-semibold text-espresso-800" htmlFor="resolution-window">
                  Challenge window
                </label>
                <span className="font-display text-[15px] font-extrabold text-honey-700">
                  {resolutionWindowHours} {resolutionWindowHours === 1 ? 'hour' : 'hours'}
                </span>
              </div>
              <p className={`mb-2.5 mt-0.5 ${rowHelpClasses}`}>
                How long a called result can be disputed, and how long a vote stays open. Under 2 hours, people miss it.
              </p>
              <input
                id="resolution-window"
                type="range"
                min={0.5}
                max={10}
                step={0.5}
                value={resolutionWindowHours}
                onChange={(e) => setResolutionWindowHours(Number(e.target.value))}
                className="w-full accent-honey-500"
              />
              <div className="mt-0.5 flex justify-between text-[11px] text-espresso-300">
                <span>30 min</span>
                <span>10 hours</span>
              </div>
            </div>
          </SettingsCard>
        </section>

        <section>
          <SectionLabel>Seasons &amp; time</SectionLabel>
          <SettingsCard>
            <div className={rowClasses}>
              <div className="flex items-center justify-between gap-3">
                <span className={rowLabelClasses}>Season length</span>
                {/* Already-on seasons get a padlock pill instead of a disabled switch: a greyed-out
                    switch reads as "not available yet" rather than "this decision is final". */}
                {settings.seasons_enabled ? (
                  <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-espresso-50 px-2.5 py-[3px] text-[11px] font-bold text-espresso-500">
                    <LockIcon className="h-[11px] w-[11px]" />
                    Seasons stay on
                  </span>
                ) : (
                  <Switch checked={seasonsEnabled} onChange={() => setSeasonsEnabled((v) => !v)} />
                )}
              </div>
              <p className={`mt-0.5 ${rowHelpClasses}`}>
                {seasonsEnabled
                  ? 'At the end of each one, standings archive to Awards and everyone is reseeded.'
                  : 'Off: the board never resets. Turning seasons on is permanent.'}
              </p>

              {seasonsEnabled && (
                <>
                  <div className="mt-2.5 flex flex-wrap gap-[7px]">
                    {(['1m', '2m', '3m', 'manual', 'custom'] as SeasonLength[]).map((len) => (
                      <button
                        type="button"
                        key={len}
                        onClick={() => setSeasonLength(len)}
                        aria-pressed={seasonLength === len}
                        className={`rounded-full border-[1.5px] px-3 py-[5px] text-[13px] ${
                          seasonLength === len
                            ? 'border-honey-500 bg-honey-50 font-bold text-honey-800'
                            : 'border-espresso-200 font-semibold text-espresso-600'
                        }`}
                      >
                        {SEASON_LENGTH_SHORT_LABEL[len]}
                      </button>
                    ))}
                  </div>
                  <p className={`mt-2 ${rowHelpClasses}`}>{SEASON_LENGTH_HINTS[seasonLength]}</p>

                  {seasonLength === 'custom' && (
                    <input
                      type="datetime-local"
                      min={minSeasonEndsAt}
                      value={seasonCustomEndsAt}
                      onChange={(e) => setSeasonCustomEndsAt(e.target.value)}
                      required
                      className={`${inputClasses} mt-2`}
                    />
                  )}
                </>
              )}
            </div>

            <div className={rowClasses}>
              <label className={rowLabelClasses} htmlFor="group-timezone">
                Time zone
              </label>
              <p className={`mb-2 mt-0.5 ${rowHelpClasses}`}>
                Shown beside every betting-closes time so nobody guesses what you meant.
              </p>
              <select id="group-timezone" value={timezone} onChange={(e) => setTimezone(e.target.value)} className={selectClasses}>
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
          </SettingsCard>
        </section>

        <p className="px-0.5 text-xs leading-[1.5] text-espresso-400">
          {seasonsEnabled
            ? "Betting itself is opened per season from the group page, not here. Seasons can't be switched off once they're on."
            : 'Betting can only be switched on once. After that, pausing play is what ending a season is for.'}
        </p>
      </div>

      <div className="fixed inset-x-0 bottom-[var(--bottomnav-height)] z-20 border-t border-espresso-100 bg-paper-white/95 px-5 pb-5 pt-3 backdrop-blur-sm">
        <div className="mx-auto flex max-w-lg gap-2.5">
          <Button type="button" variant="outline" className="flex-1" disabled={isPending} onClick={back}>
            Cancel
          </Button>
          <Button
            type="button"
            className="flex-[1.4]"
            disabled={isPending || (distributePayout && !creatorPctValid)}
            onClick={save}
          >
            Save changes
          </Button>
        </div>
      </div>

      {confirmingBetting && (
        <Modal onClose={() => setConfirmingBetting(false)}>
          <p className="font-display text-lg font-bold text-espresso-900">Turn betting on?</p>
          <p className="text-sm text-espresso-600">Once betting is on, it can&apos;t be turned back off from here.</p>
          <div className="flex gap-2 pt-1">
            <Button type="button" variant="outline" className="flex-1" onClick={() => setConfirmingBetting(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              className="flex-1"
              onClick={() => {
                setBettingEnabled(true);
                setConfirmingBetting(false);
              }}
            >
              Turn on
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
}

/** The two pills under the invite code. Regenerating kills every link already sent, so it asks first. */
export function InviteCodeActions({ groupId, inviteCode, canRegenerate }: { groupId: string; inviteCode: string; canRegenerate: boolean }) {
  const router = useRouter();
  const [copied, setCopied] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const pillClasses =
    'flex-1 rounded-full border border-espresso-200 px-3 py-[7px] text-[12.5px] font-bold text-espresso-800 transition-colors hover:bg-espresso-50 disabled:cursor-not-allowed disabled:text-espresso-300';

  return (
    <div className="mt-2.5 space-y-2">
      {error && <p className="text-xs text-danger-700">{error}</p>}
      <div className="flex gap-2">
        <button
          type="button"
          className={pillClasses}
          onClick={async () => {
            // window is only available client-side, so the absolute URL is built at click time
            // rather than held in state that would have to match a server render first.
            await navigator.clipboard.writeText(`${window.location.origin}/join/${inviteCode}`);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          }}
        >
          {copied ? 'Copied' : 'Copy link'}
        </button>
        {canRegenerate && (
          <button type="button" className={pillClasses} disabled={isPending} onClick={() => setConfirming(true)}>
            Regenerate
          </button>
        )}
      </div>

      {confirming && (
        <Modal onClose={() => setConfirming(false)}>
          <p className="font-display text-lg font-extrabold tracking-[-0.015em] text-espresso-950">Regenerate the invite code?</p>
          <p className="text-sm leading-[1.5] text-espresso-600">
            Every link and code you&apos;ve already shared stops working. Anyone already in the group stays in.
          </p>
          <div className="flex gap-2 pt-1">
            <Button type="button" variant="outline" className="flex-1" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              className="flex-1"
              disabled={isPending}
              onClick={() =>
                startTransition(async () => {
                  const result = await regenerateInviteCode(groupId);
                  if (result.error) {
                    setError(result.error);
                    setConfirming(false);
                  } else {
                    setConfirming(false);
                    router.refresh();
                  }
                })
              }
            >
              Regenerate
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}

export function RemoveMemberButton({ groupId, userId, nickname }: { groupId: string; userId: string; nickname: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  return (
    <>
      <button type="button" onClick={() => setConfirming(true)} className="text-[13px] font-semibold text-danger-700 hover:underline">
        Remove
      </button>

      {confirming && (
        <Modal onClose={() => setConfirming(false)}>
          <p className="font-display text-lg font-extrabold tracking-[-0.015em] text-espresso-950">
            Remove <Mention nickname={nickname} />?
          </p>
          {error && <p className="text-sm text-danger-700">{error}</p>}
          <div className="pt-0.5">
            <ConsequenceRow dotClassName="bg-danger-500">Their open bets are refunded and they lose access straight away.</ConsequenceRow>
            <ConsequenceRow dotClassName="bg-espresso-800">The invite code rotates, so their copy of it stops working.</ConsequenceRow>
            <ConsequenceRow dotClassName="bg-espresso-200" isLast>
              Being removed is permanent. They can&apos;t rejoin with a new code.
            </ConsequenceRow>
          </div>
          <div className="flex gap-2 pt-1">
            <Button type="button" variant="outline" className="flex-1" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="danger"
              className="flex-1"
              disabled={isPending}
              onClick={() =>
                startTransition(async () => {
                  const result = await removeMember(groupId, userId);
                  if (result.error) {
                    setError(result.error);
                  } else {
                    setConfirming(false);
                    router.refresh();
                  }
                })
              }
            >
              Remove
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
}

/** The three owner-only rows, each a whole-row button that opens its own sheet. */
export function OwnerOnlySection({
  groupId,
  groupName,
  resolutionWindowHours,
  activeSeason,
  members,
  deletionScheduled,
}: {
  groupId: string;
  groupName: string;
  resolutionWindowHours: number;
  activeSeason: { id: string; number: number; name: string | null } | null;
  members: { userId: string; nickname: string }[];
  deletionScheduled: boolean;
}) {
  const [openSheet, setOpenSheet] = useState<null | 'end-season' | 'transfer' | 'delete'>(null);

  return (
    <section>
      <SectionLabel>Owner only</SectionLabel>
      <SettingsCard>
        {activeSeason && (
          <button type="button" className={settingsNavRowClasses} onClick={() => setOpenSheet('end-season')}>
            <NavRowContent
              label="End season now"
              consequence={`Voids anything without a proposed result. Anything mid-vote gets ${resolutionWindowHours} more hours.`}
            />
          </button>
        )}
        <button type="button" className={settingsNavRowClasses} onClick={() => setOpenSheet('transfer')}>
          <NavRowContent label="Transfer ownership" consequence="You stay in the group as a regular member." />
        </button>
        {!deletionScheduled && (
          <button type="button" className={settingsNavRowClasses} onClick={() => setOpenSheet('delete')}>
            <NavRowContent
              label="Delete this group"
              consequence="Every open market is voided and refunded, then it's gone for everyone."
              danger
            />
          </button>
        )}
      </SettingsCard>

      {openSheet === 'end-season' && activeSeason && (
        <EndSeasonSheet
          groupId={groupId}
          season={activeSeason}
          resolutionWindowHours={resolutionWindowHours}
          onClose={() => setOpenSheet(null)}
        />
      )}
      {openSheet === 'transfer' && <TransferOwnershipSheet groupId={groupId} members={members} onClose={() => setOpenSheet(null)} />}
      {openSheet === 'delete' && <DeleteGroupSheet groupId={groupId} groupName={groupName} onClose={() => setOpenSheet(null)} />}
    </section>
  );
}

/** Naming the season lives here rather than on the settings list: the name is what gets archived to
 *  Awards, so the moment you're about to end it is the last chance to make it read as anything
 *  other than "Season 3". */
function EndSeasonSheet({
  groupId,
  season,
  resolutionWindowHours,
  onClose,
}: {
  groupId: string;
  season: { id: string; number: number; name: string | null };
  resolutionWindowHours: number;
  onClose: () => void;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  return (
    <Modal onClose={onClose}>
      <p className="font-display text-lg font-extrabold tracking-[-0.015em] text-espresso-950">
        End {season.name ?? `Season ${season.number}`}?
      </p>
      {error && <p className="text-sm text-danger-700">{error}</p>}
      <div className="pt-0.5">
        <ConsequenceRow dotClassName="bg-danger-500">
          Every market without a proposed result is voided and refunded.
        </ConsequenceRow>
        <ConsequenceRow dotClassName="bg-espresso-800">
          Anything already awaiting a challenge or a vote gets up to {resolutionWindowHours} more hours to finish.
        </ConsequenceRow>
        <ConsequenceRow dotClassName="bg-espresso-200" isLast>
          Standings archive to Awards, then intermission opens and everyone is reseeded for the next one.
        </ConsequenceRow>
      </div>

      <div className="rounded-[10px] border border-espresso-100 bg-paper p-3">
        <p className="mb-1.5 text-xs font-bold text-espresso-500">This season&apos;s name is what shows up in Awards.</p>
        <SeasonNameEditor groupId={groupId} seasonId={season.id} currentName={season.name} seasonNumber={season.number} />
      </div>

      <div className="flex gap-2 pt-1">
        <Button type="button" variant="outline" className="flex-1" onClick={onClose}>
          Not yet
        </Button>
        <Button
          type="button"
          variant="danger"
          className="flex-1"
          disabled={isPending}
          onClick={() =>
            startTransition(async () => {
              const result = await endSeason(groupId);
              if (result.error) {
                setError(result.error);
              } else {
                router.push(`/groups/${groupId}/intermission`);
              }
            })
          }
        >
          End season
        </Button>
      </div>
    </Modal>
  );
}

function TransferOwnershipSheet({
  groupId,
  members,
  onClose,
}: {
  groupId: string;
  members: { userId: string; nickname: string }[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const selectedNickname = members.find((m) => m.userId === selected)?.nickname;

  return (
    <Modal onClose={onClose}>
      <p className="font-display text-lg font-extrabold tracking-[-0.015em] text-espresso-950">
        {selectedNickname ? (
          <>
            Hand the group to <Mention nickname={selectedNickname} />?
          </>
        ) : (
          'Hand the group to someone else?'
        )}
      </p>
      {error && <p className="text-sm text-danger-700">{error}</p>}

      {members.length === 0 ? (
        <>
          <p className="text-sm leading-[1.55] text-espresso-600">
            There&apos;s nobody to hand it to yet. Only active members other than you can take it on.
          </p>
          <Button type="button" variant="outline" className="w-full" onClick={onClose}>
            Close
          </Button>
        </>
      ) : (
        <>
          <p className="text-sm leading-[1.55] text-espresso-600">
            You stay in the group as a regular member. From then on only{' '}
            {selectedNickname ? <Mention nickname={selectedNickname} /> : 'they'} can change how the group plays, remove people,
            or transfer it back.
          </p>
          <select value={selected} onChange={(e) => setSelected(e.target.value)} className={selectClasses}>
            <option value="">Choose a member…</option>
            {members.map((m) => (
              <option key={m.userId} value={m.userId}>
                @{m.nickname}
              </option>
            ))}
          </select>
          <div className="flex gap-2 pt-1">
            <Button type="button" variant="outline" className="flex-1" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="danger"
              className="flex-1"
              disabled={isPending || !selected}
              onClick={() =>
                startTransition(async () => {
                  const result = await transferOwnership(groupId, selected);
                  if (result.error) {
                    setError(result.error);
                  } else {
                    onClose();
                    router.refresh();
                  }
                })
              }
            >
              Transfer
            </Button>
          </div>
        </>
      )}
    </Modal>
  );
}

function DeleteGroupSheet({ groupId, groupName, onClose }: { groupId: string; groupName: string; onClose: () => void }) {
  const router = useRouter();
  const [typed, setTyped] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  return (
    <Modal onClose={onClose}>
      <span className="flex h-[38px] w-[38px] items-center justify-center rounded-full bg-danger-100">
        <AlertTriangleIcon className="h-5 w-5 text-danger-700" />
      </span>
      <p className="font-display text-lg font-extrabold tracking-[-0.015em] text-espresso-950">Delete {groupName}?</p>
      {error && <p className="text-sm text-danger-700">{error}</p>}
      <div className="pt-0.5">
        <ConsequenceRow dotClassName="bg-danger-500">Every open market is voided and refunded first.</ConsequenceRow>
        <ConsequenceRow dotClassName="bg-espresso-800">Everyone keeps read access for 5 days, then it&apos;s gone.</ConsequenceRow>
        <ConsequenceRow dotClassName="bg-espresso-200" isLast>
          Awards, seasons and history go with it. This can&apos;t be undone.
        </ConsequenceRow>
      </div>

      <div className="space-y-1.5">
        <label className="block text-xs font-bold text-espresso-500" htmlFor="delete-confirm">
          Type the group name to confirm
        </label>
        <input
          id="delete-confirm"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          placeholder={groupName}
          className="w-full rounded-[10px] border border-espresso-200 bg-paper-white px-3.5 py-2.5 text-sm text-espresso-950 focus:border-honey-500 focus:outline-none focus:ring-2 focus:ring-honey-200"
        />
      </div>

      <div className="flex gap-2 pt-1">
        <Button type="button" variant="outline" className="flex-1" onClick={onClose}>
          Cancel
        </Button>
        <Button
          type="button"
          variant="danger"
          className="flex-1 disabled:bg-danger-100 disabled:text-danger-500"
          disabled={isPending || typed !== groupName}
          onClick={() =>
            startTransition(async () => {
              const result = await deleteGroup(groupId);
              if (result.error) {
                setError(result.error);
              } else {
                router.push('/groups');
              }
            })
          }
        >
          Delete
        </Button>
      </div>
    </Modal>
  );
}
