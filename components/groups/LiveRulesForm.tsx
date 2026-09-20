'use client';

import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { updateGroupSettings, type GroupSettings } from '@/lib/actions/groups';
import { openSeasonBetting } from '@/lib/actions/seasons';
import {
  bettingStatus,
  formatChallengeWindow,
  groupSettingsInput,
  type ActiveSeasonSummary,
} from '@/lib/groupManage';import { PageHeader } from '@/components/ui/PageHeader';
import { SectionLabel, SettingsCard } from '@/components/ui/SettingsList';
import { Switch } from '@/components/ui/Switch';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { CaretDownIcon, LockIcon } from '@/components/ui/icons';
import { SaveStatusChip, type SaveState } from '@/components/groups/SaveStatusChip';
import { EndSeasonSheet } from '@/components/groups/SettingsActions';
import { formatTokens } from '@/lib/formatNumber';
import { JOIN_MESSAGE_MAX_LENGTH } from '@/lib/limits';
import { COMMON_TIMEZONES, friendlyTimezoneName } from '@/lib/timezone';
import { SEASON_LENGTH_SHORT_LABEL, type SeasonLength } from '@/lib/seasonLength';
import { cn } from '@/lib/cn';

const SEASON_LENGTH_BRIEF: Record<SeasonLength, string> = {
  '1m': 'Resets every month.',
  '2m': 'Resets every two months.',
  '3m': 'Resets every three months.',
  manual: 'Runs until you end it.',
  custom: 'Ends at the date you pick.',
};

const STEPPER_MIN = 100;
const STEPPER_MAX = 10_000;
const STEPPER_STEP = 100;

const selectClasses =
  'w-full rounded-[10px] border border-hairline bg-surface px-3.5 py-2.5 text-[15px] font-semibold text-ink focus:border-signal focus:outline-none focus:ring-2 focus:ring-signal/15';

const inputClasses =
  'w-full rounded-[10px] border border-hairline bg-surface px-3.5 py-2.5 text-[15px] font-bold text-ink focus:border-signal focus:outline-none focus:ring-2 focus:ring-signal/15';

function toLocalDatetimeInputValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function stepSeed(current: number, dir: 1 | -1): number {
  if (dir < 0 && current <= STEPPER_MIN) return current;
  if (dir > 0 && current >= STEPPER_MAX) return current;
  if (dir < 0 && current > STEPPER_MAX) return STEPPER_MAX;
  if (dir > 0 && current < STEPPER_MIN) return STEPPER_MIN;
  return current + dir * STEPPER_STEP;
}

type Local = {
  seedAmount: number;
  seasonsEnabled: boolean;
  seasonLength: SeasonLength;
  seasonCustomEndsAt: string;
  timezone: string;
  bettingEnabled: boolean;
  acceptingMembers: boolean;
  distributePayout: boolean;
  creatorPayoutPct: number;
  allowHedgedBets: boolean;
  resolutionWindowHours: number;
  requireEndorsement: boolean;
  joinMessage: string;
  awardsEnabled: boolean;
};

function fromSettings(settings: GroupSettings): Local {
  return {
    seedAmount: settings.seed_amount,
    seasonsEnabled: settings.seasons_enabled,
    seasonLength: (settings.season_length ?? 'manual') as SeasonLength,
    seasonCustomEndsAt: toLocalDatetimeInputValue(
      settings.season_custom_ends_at ? new Date(settings.season_custom_ends_at) : new Date(Date.now() + 24 * 60 * 60_000)
    ),
    timezone: settings.timezone,
    bettingEnabled: settings.betting_enabled,
    acceptingMembers: settings.accepting_members,
    distributePayout: settings.distribute_payout,
    creatorPayoutPct: settings.creator_payout_pct,
    allowHedgedBets: settings.allow_hedged_bets,
    resolutionWindowHours: settings.resolution_window_hours,
    requireEndorsement: settings.require_endorsement,
    joinMessage: settings.join_message ?? '',
    awardsEnabled: settings.awards_enabled,
  };
}

function toPatch(local: Local) {
  return {
    seedAmount: local.seedAmount,
    seasonsEnabled: local.seasonsEnabled,
    seasonLength: local.seasonsEnabled ? local.seasonLength : null,
    seasonCustomEndsAt:
      local.seasonsEnabled && local.seasonLength === 'custom' ? new Date(local.seasonCustomEndsAt).toISOString() : null,
    timezone: local.timezone,
    bettingEnabled: local.bettingEnabled,
    acceptingMembers: local.acceptingMembers,
    distributePayout: local.distributePayout,
    creatorPayoutPct: local.creatorPayoutPct,
    allowHedgedBets: local.allowHedgedBets,
    resolutionWindowHours: local.resolutionWindowHours,
    requireEndorsement: local.requireEndorsement,
    joinMessage: local.joinMessage.trim() ? local.joinMessage : null,
    awardsEnabled: local.awardsEnabled,
  };
}

export function LiveRulesForm({
  groupId,
  settings,
  season,
  activeSeason,
  isPublic,
  canEdit,
  backLabel,
}: {
  groupId: string;
  settings: GroupSettings;
  season: ActiveSeasonSummary | null;
  activeSeason: { id: string; number: number; name: string | null } | null;
  isPublic: boolean;
  canEdit: boolean;
  backLabel: string;
}) {
  const router = useRouter();
  const [committed, setCommitted] = useState(settings);
  const [local, setLocal] = useState(() => fromSettings(settings));
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [moreOpen, setMoreOpen] = useState(false);
  const [confirmingBetting, setConfirmingBetting] = useState(false);
  const [endingSeason, setEndingSeason] = useState(false);
  const [seasonBettingOpen, setSeasonBettingOpen] = useState(!!season?.bettingOpen);
  const [bettingError, setBettingError] = useState<string | null>(null);
  const [isOpeningBetting, startOpeningBetting] = useTransition();
  const [minSeasonEndsAt] = useState(() => toLocalDatetimeInputValue(new Date(Date.now() + 60_000)));

  const committedRef = useRef(committed);
  const localRef = useRef(local);
  const retryLocalRef = useRef<Local | null>(null);
  const queueRef = useRef(Promise.resolve());
  const seedTimerRef = useRef<number | null>(null);
  const holdTimeoutRef = useRef<number | null>(null);
  const holdIntervalRef = useRef<number | null>(null);
  committedRef.current = committed;
  localRef.current = local;

  const persist = useCallback(() => {
    queueRef.current = queueRef.current.then(async () => {
      const snapshot = committedRef.current;
      const current = localRef.current;
      setSaveState('saving');
      const result = await updateGroupSettings(groupId, groupSettingsInput(snapshot, isPublic, toPatch(current)));
      if (result.error || !result.data) {
        const rolled = fromSettings(snapshot);
        setLocal(rolled);
        localRef.current = rolled;
        retryLocalRef.current = current;
        setSaveState('error');
        return;
      }
      setCommitted(result.data);
      committedRef.current = result.data;
      retryLocalRef.current = null;
      setSaveState('saved');
      router.refresh();
    });
  }, [groupId, isPublic, router]);

  function retry() {
    if (retryLocalRef.current) {
      setLocal(retryLocalRef.current);
      localRef.current = retryLocalRef.current;
    }
    persist();
  }

  function patchLocal(partial: Partial<Local>, write: 'now' | 'debounce' | 'hold' = 'now') {
    setLocal((prev) => {
      const next = { ...prev, ...partial };
      localRef.current = next;
      return next;
    });
    if (write === 'now') persist();
    if (write === 'debounce') {
      if (seedTimerRef.current) window.clearTimeout(seedTimerRef.current);
      seedTimerRef.current = window.setTimeout(() => persist(), 600);
    }
  }

  function startHold(dir: 1 | -1) {
    const apply = () => {
      const next = stepSeed(localRef.current.seedAmount, dir);
      if (next === localRef.current.seedAmount) return;
      patchLocal({ seedAmount: next }, 'debounce');
    };
    apply();
    holdTimeoutRef.current = window.setTimeout(() => {
      holdIntervalRef.current = window.setInterval(apply, 80);
    }, 500);
  }

  function stopHold() {
    if (holdTimeoutRef.current) window.clearTimeout(holdTimeoutRef.current);
    if (holdIntervalRef.current) window.clearInterval(holdIntervalRef.current);
    holdTimeoutRef.current = null;
    holdIntervalRef.current = null;
  }

  useEffect(
    () => () => {
      if (holdTimeoutRef.current) window.clearTimeout(holdTimeoutRef.current);
      if (holdIntervalRef.current) window.clearInterval(holdIntervalRef.current);
      if (seedTimerRef.current) window.clearTimeout(seedTimerRef.current);
    },
    []
  );

  const betting = bettingStatus({ ...committed, betting_enabled: local.bettingEnabled, seasons_enabled: local.seasonsEnabled }, season);
  const bettingOn = committed.seasons_enabled ? seasonBettingOpen : local.bettingEnabled;
  const bettingLockedOn = committed.seasons_enabled ? seasonBettingOpen : committed.betting_enabled;
  const betweenSeasons = committed.seasons_enabled && !season;
  const fillPct = ((local.resolutionWindowHours - 0.5) / 9.5) * 100;
  const creatorPctValid = Number.isFinite(local.creatorPayoutPct) && local.creatorPayoutPct >= 0 && local.creatorPayoutPct <= 100;
  const openMarketsPct = creatorPctValid ? 100 - local.creatorPayoutPct : '—';
  const seasonsLocked = committed.seasons_enabled;

  const moreHint = isPublic ? 'Time zone' : 'Seasons, payouts, time zone, awards';

  return (
    <>
      <PageHeader
        title="Group rules"
        backHref={`/groups/${groupId}/settings`}
        backLabel={backLabel}
        action={canEdit ? <SaveStatusChip state={saveState} onRetry={retry} /> : undefined}
      />

      <section>
        <SectionLabel
          action={
            <Link href={`/how-it-works?group=${groupId}&tab=your-group`} className="text-[11.5px] font-bold text-signal">
              Explain the rules ›
            </Link>
          }
        >
          How this group plays
        </SectionLabel>

        <SettingsCard>
          {!isPublic &&
            (canEdit && !betweenSeasons ? (
              <ToggleRow
                label="Betting"
                helper={bettingOn ? 'Anyone can start a market' : 'No one can start a market'}
                checked={bettingOn}
                disabled={bettingLockedOn}
                onChange={() => {
                  if (!bettingOn) setConfirmingBetting(true);
                }}
              />
            ) : (
              <ValueRow label="Betting" helper={betting.consequence} value={canEdit ? betting.value : betting.memberValue} />
            ))}

          {!isPublic &&
            (canEdit ? (
              <ToggleRow
                label="Endorsement"
                helper={local.requireEndorsement ? 'Markets need a second to open' : 'Markets open when created'}
                checked={local.requireEndorsement}
                onChange={() => patchLocal({ requireEndorsement: !local.requireEndorsement })}
              />
            ) : (
              <ValueRow
                label="Endorsement"
                helper={local.requireEndorsement ? 'Markets need a second to open' : 'Markets open when created'}
                value={local.requireEndorsement ? 'On' : 'Off'}
              />
            ))}

          {!isPublic &&
            (canEdit ? (
              <ToggleRow
                label="Hedging"
                helper={local.allowHedgedBets ? 'Can back more than one side' : 'One side per market'}
                checked={local.allowHedgedBets}
                onChange={() => patchLocal({ allowHedgedBets: !local.allowHedgedBets })}
              />
            ) : (
              <ValueRow
                label="Hedging"
                helper={local.allowHedgedBets ? 'Can back more than one side' : 'One side per market'}
                value={local.allowHedgedBets ? 'On' : 'Off'}
              />
            ))}

          {canEdit ? (
            <div className="flex items-center justify-between gap-3.5 px-4 py-[13px]">
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-ink">Token allocation</span>
                <span className="mt-0.5 block text-xs leading-[1.45] text-faint">What each new member starts with</span>
              </span>
              <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full border border-hairline p-[3px]">
                <button
                  type="button"
                  aria-label="Decrease token allocation"
                  disabled={local.seedAmount <= STEPPER_MIN}
                  onPointerDown={(e) => {
                    e.preventDefault();
                    startHold(-1);
                  }}
                  onPointerUp={stopHold}
                  onPointerCancel={stopHold}
                  onPointerLeave={stopHold}
                  className="flex h-[26px] w-[26px] items-center justify-center rounded-full bg-rule text-[15px] font-extrabold text-muted disabled:opacity-40"
                >
                  −
                </button>
                <span className="min-w-12 text-center text-sm font-extrabold text-ink">{formatTokens(local.seedAmount)}</span>
                <button
                  type="button"
                  aria-label="Increase token allocation"
                  disabled={local.seedAmount >= STEPPER_MAX}
                  onPointerDown={(e) => {
                    e.preventDefault();
                    startHold(1);
                  }}
                  onPointerUp={stopHold}
                  onPointerCancel={stopHold}
                  onPointerLeave={stopHold}
                  className="flex h-[26px] w-[26px] items-center justify-center rounded-full bg-rule text-[15px] font-extrabold text-muted disabled:opacity-40"
                >
                  +
                </button>
              </span>
            </div>
          ) : (
            <ValueRow label="Token allocation" helper="What each new member starts with" value={formatTokens(local.seedAmount)} />
          )}

          {!isPublic && (
            <div className="px-4 py-[13px]">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-sm font-semibold text-ink">Challenge window</span>
                <span className="font-display text-[15px] font-extrabold text-signal">
                  {formatChallengeWindow(local.resolutionWindowHours)}
                </span>
              </div>
              <p className="mt-0.5 text-xs leading-[1.45] text-faint">
                How long a called result can be disputed.
              </p>
              {canEdit && (
                <>
                  <input
                    type="range"
                    min={0.5}
                    max={10}
                    step={0.5}
                    value={local.resolutionWindowHours}
                    onChange={(e) =>
                      setLocal((prev) => {
                        const next = { ...prev, resolutionWindowHours: Number(e.target.value) };
                        localRef.current = next;
                        return next;
                      })
                    }
                    onPointerUp={() => persist()}
                    onKeyUp={() => persist()}
                    className="challenge-window-slider mt-2.5 w-full"
                    style={{ ['--fill' as string]: `${fillPct}%` }}
                  />
                  <div className="mt-1 flex justify-between text-[11px] text-faint">
                    <span>30 min</span>
                    <span>10 hours</span>
                  </div>
                </>
              )}
            </div>
          )}

          <div>
            <button
              type="button"
              onClick={() => setMoreOpen((v) => !v)}
              className="flex w-full items-center justify-between gap-3.5 px-4 py-[13px] text-left"
            >
              <span className="text-[13px] font-bold text-signal">More rules</span>
              <span className="flex items-center gap-2">
                <span className="text-[11.5px] text-faint">{moreHint}</span>
                <CaretDownIcon className={cn('h-3.5 w-3.5 text-signal transition-transform duration-200', moreOpen && 'rotate-180')} />
              </span>
            </button>
            <div className={cn('grid transition-[grid-template-rows] duration-200 ease-out', moreOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]')}>
              <div className="overflow-hidden">
                {!isPublic && (
                  <div className="border-t border-hairline px-4 py-[13px]">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-sm font-semibold text-ink">Season length</span>
                      {canEdit ? (
                        seasonsLocked ? (
                          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-rule px-2.5 py-[3px] text-[11px] font-bold text-muted">
                            <LockIcon className="h-[11px] w-[11px]" />
                            Seasons stay on
                          </span>
                        ) : (
                          <Switch checked={local.seasonsEnabled} onChange={() => patchLocal({ seasonsEnabled: !local.seasonsEnabled })} />
                        )
                      ) : (
                        <span className="shrink-0 text-sm font-bold text-ink">{local.seasonsEnabled ? 'On' : 'Off'}</span>
                      )}
                    </div>
                    <p className="mt-0.5 text-xs leading-[1.45] text-faint">
                      {local.seasonsEnabled
                        ? 'Standings archive, then everyone is reseeded.'
                        : 'The board never resets. Turning seasons on is permanent.'}
                    </p>
                    {local.seasonsEnabled && canEdit && (
                      <>
                        <div className="mt-2.5 flex flex-wrap gap-[7px]">
                          {(['1m', '2m', '3m', 'manual', 'custom'] as SeasonLength[]).map((len) => (
                            <button
                              type="button"
                              key={len}
                              onClick={() => patchLocal({ seasonLength: len })}
                              aria-pressed={local.seasonLength === len}
                              className={`rounded-full border-[1.5px] px-3 py-[5px] text-[13px] ${
                                local.seasonLength === len
                                  ? 'border-signal bg-signal-tint font-bold text-signal-deep'
                                  : 'border-hairline font-semibold text-muted'
                              }`}
                            >
                              {SEASON_LENGTH_SHORT_LABEL[len]}
                            </button>
                          ))}
                        </div>
                        <p className="mt-2 text-xs leading-[1.45] text-faint">{SEASON_LENGTH_BRIEF[local.seasonLength]}</p>
                        {local.seasonLength === 'custom' && (
                          <input
                            type="datetime-local"
                            min={minSeasonEndsAt}
                            value={local.seasonCustomEndsAt}
                            onChange={(e) => patchLocal({ seasonCustomEndsAt: e.target.value }, 'now')}
                            className={`${inputClasses} mt-2`}
                          />
                        )}
                        {local.seasonLength === 'manual' && activeSeason && (
                          <Button
                            type="button"
                            variant="outline"
                            className="mt-3 w-full"
                            onClick={() => setEndingSeason(true)}
                          >
                            End this season
                          </Button>
                        )}
                      </>
                    )}
                    {local.seasonsEnabled && !canEdit && (
                      <p className="mt-1 text-sm font-bold text-ink">{SEASON_LENGTH_SHORT_LABEL[local.seasonLength]}</p>
                    )}
                  </div>
                )}

                {!isPublic &&
                  (canEdit ? (
                    <div className="border-t border-hairline">
                      <ToggleRow
                        label="Split universal losses"
                        helper={
                          local.distributePayout
                            ? 'Creator takes a cut, rest goes to open markets.'
                            : 'Stakes go back to whoever bet.'
                        }
                        checked={local.distributePayout}
                        onChange={() => patchLocal({ distributePayout: !local.distributePayout })}
                      />
                      {local.distributePayout && (
                        <div className="space-y-2 px-4 pb-3.5">
                          <div className="flex gap-3">
                            <label className="flex-1 space-y-1">
                              <span className="block text-xs font-bold text-muted">Creator %</span>
                              <input
                                type="number"
                                min={0}
                                max={100}
                                value={local.creatorPayoutPct}
                                onChange={(e) =>
                                  setLocal((prev) => {
                                    const next = { ...prev, creatorPayoutPct: Number(e.target.value) };
                                    localRef.current = next;
                                    return next;
                                  })
                                }
                                onBlur={() => {
                                  if (creatorPctValid) persist();
                                }}
                                className={inputClasses}
                              />
                            </label>
                            <div className="flex-1 space-y-1">
                              <span className="block text-xs font-bold text-muted">Open markets %</span>
                              <div className="w-full rounded-[10px] border border-hairline bg-rule px-3.5 py-2.5 text-[15px] font-bold text-faint">
                                {openMarketsPct}
                              </div>
                            </div>
                          </div>
                          {!creatorPctValid && <p className="text-xs text-alert">The creator percentage has to be between 0 and 100.</p>}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="border-t border-hairline">
                      <ValueRow
                        label="When nobody calls it"
                        helper={
                          local.distributePayout
                            ? `Creator takes ${local.creatorPayoutPct}%, rest to open markets`
                            : 'Bets get refunded'
                        }
                        value={local.distributePayout ? 'Split' : 'Refunded'}
                      />
                    </div>
                  ))}

                <div className="border-t border-hairline px-4 py-[13px]">
                  <label className="block text-sm font-semibold text-ink" htmlFor="group-timezone">
                    Time zone
                  </label>
                  <p className="mt-0.5 mb-2 text-xs leading-[1.45] text-faint">Shown next to every closing time.</p>
                  {canEdit ? (
                    <select
                      id="group-timezone"
                      value={local.timezone}
                      onChange={(e) => patchLocal({ timezone: e.target.value })}
                      className={selectClasses}
                    >
                      {!(COMMON_TIMEZONES as readonly string[]).includes(local.timezone) && (
                        <option value={local.timezone}>{friendlyTimezoneName(local.timezone)}</option>
                      )}
                      {COMMON_TIMEZONES.map((tz) => (
                        <option key={tz} value={tz}>
                          {friendlyTimezoneName(tz)}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <p className="text-sm font-bold text-ink">{friendlyTimezoneName(local.timezone).replace(/ time$/, '')}</p>
                  )}
                </div>

                {!isPublic &&
                  (canEdit ? (
                    <div className="border-t border-hairline">
                      <ToggleRow
                        label="Titles & custom awards"
                        helper={
                          local.awardsEnabled
                            ? 'Titles and custom awards compute.'
                            : 'Awards page is hidden.'
                        }
                        checked={local.awardsEnabled}
                        onChange={() => patchLocal({ awardsEnabled: !local.awardsEnabled })}
                      />
                    </div>
                  ) : (
                    <div className="border-t border-hairline">
                      <ValueRow
                        label="Titles & custom awards"
                        helper={
                          local.awardsEnabled
                            ? 'Titles and custom awards compute.'
                            : 'Awards page is hidden.'
                        }
                        value={local.awardsEnabled ? 'On' : 'Off'}
                      />
                    </div>
                  ))}

                {!isPublic &&
                  (canEdit ? (
                    <div className="border-t border-hairline">
                      <ToggleRow
                        label="Accepting new members"
                        helper={
                          local.acceptingMembers
                            ? 'Anyone with the code can join.'
                            : 'Joining is paused.'
                        }
                        checked={local.acceptingMembers}
                        onChange={() => patchLocal({ acceptingMembers: !local.acceptingMembers })}
                      />
                    </div>
                  ) : (
                    <div className="border-t border-hairline">
                      <ValueRow
                        label="Accepting new members"
                        helper={
                          local.acceptingMembers
                            ? 'Anyone with the code can join'
                            : 'Joining is paused'
                        }
                        value={local.acceptingMembers ? 'On' : 'Off'}
                      />
                    </div>
                  ))}

                {!isPublic && (
                  <div className="border-t border-hairline px-4 py-[13px]">
                    <label className="block text-sm font-semibold text-ink" htmlFor="join-message">
                      Join message
                    </label>
                    <p className="mt-0.5 mb-2 text-xs leading-[1.45] text-faint">Shown when someone joins. Leave blank for none.</p>
                    {canEdit ? (
                      <>
                        <textarea
                          id="join-message"
                          value={local.joinMessage}
                          onChange={(e) =>
                            setLocal((prev) => {
                              const next = { ...prev, joinMessage: e.target.value };
                              localRef.current = next;
                              return next;
                            })
                          }
                          onBlur={() => {
                            const current = localRef.current.joinMessage;
                            const committedMsg = committedRef.current.join_message ?? '';
                            if (current !== committedMsg) persist();
                          }}
                          maxLength={JOIN_MESSAGE_MAX_LENGTH}
                          rows={3}
                          placeholder="Welcome to the group. House rule: no crying about bad beats."
                          className={inputClasses}
                        />
                        <span className="mt-1 block text-right text-[11px] text-faint">
                          {local.joinMessage.length} / {JOIN_MESSAGE_MAX_LENGTH}
                        </span>
                      </>
                    ) : (
                      <p className="text-sm font-bold text-ink">{local.joinMessage.trim() ? 'Set' : 'None'}</p>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </SettingsCard>
      </section>

      <p className="px-0.5 text-[11.5px] leading-[1.5] text-faint">
        {canEdit ? 'Applies to markets opened from now on.' : 'Set by the owner. Applies to markets opened from now on.'}
      </p>

      {confirmingBetting && (
        <Modal onClose={() => setConfirmingBetting(false)}>
          <p className="font-display text-lg font-bold text-ink">Turn betting on?</p>
          <p className="text-sm text-muted">Once betting is on, it can&apos;t be turned back off from here.</p>
          {bettingError && <p className="text-sm text-alert">{bettingError}</p>}
          <div className="flex gap-2 pt-1">
            <Button type="button" variant="outline" className="flex-1" onClick={() => setConfirmingBetting(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              className="flex-1"
              disabled={isOpeningBetting}
              onClick={() => {
                if (committed.seasons_enabled) {
                  if (!activeSeason) return;
                  startOpeningBetting(async () => {
                    const result = await openSeasonBetting(groupId, activeSeason.id);
                    if (result.error) {
                      setBettingError(result.error);
                      return;
                    }
                    setSeasonBettingOpen(true);
                    setBettingError(null);
                    setConfirmingBetting(false);
                    router.refresh();
                  });
                  return;
                }
                setConfirmingBetting(false);
                patchLocal({ bettingEnabled: true });
              }}
            >
              {isOpeningBetting ? 'Opening…' : 'Turn on'}
            </Button>
          </div>
        </Modal>
      )}

      {endingSeason && activeSeason && (
        <EndSeasonSheet
          groupId={groupId}
          season={activeSeason}
          resolutionWindowHours={local.resolutionWindowHours}
          onClose={() => setEndingSeason(false)}
        />
      )}
    </>
  );
}

function ToggleRow({
  label,
  helper,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  helper: React.ReactNode;
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-3.5 px-4 py-[13px]">
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-ink">{label}</span>
        <span className="mt-0.5 block text-xs leading-[1.45] text-faint">{helper}</span>
      </span>
      <Switch checked={checked} onChange={onChange} disabled={disabled} className="mt-0.5" />
    </div>
  );
}

function ValueRow({ label, helper, value }: { label: string; helper: React.ReactNode; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3.5 px-4 py-[13px]">
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-ink">{label}</span>
        <span className="mt-0.5 block text-xs leading-[1.45] text-faint">{helper}</span>
      </span>
      <span className="shrink-0 text-sm font-bold text-ink">{value}</span>
    </div>
  );
}
