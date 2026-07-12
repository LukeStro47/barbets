'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { updateGroupSettings, regenerateInviteCode, removeMember, transferOwnership, deleteGroup } from '@/lib/actions/groups';
import { endSeason } from '@/lib/actions/seasons';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Switch } from '@/components/ui/Switch';
import { formatSeasonLength, type SeasonLength } from '@/lib/seasonLength';
import { COMMON_TIMEZONES, friendlyTimezoneName } from '@/lib/timezone';
import { Mention } from '@/components/ui/Mention';
import type { GroupSettings } from '@/lib/actions/groups';

const inputClasses =
  'w-full rounded-xl border border-espresso-200 bg-paper-white px-4 py-2.5 text-espresso-900 focus:border-honey-500 focus:outline-none focus:ring-2 focus:ring-honey-200';

export function EditSettingsForm({
  groupId,
  settings,
  onDone,
}: {
  groupId: string;
  settings: GroupSettings;
  /** Renders a "Done" button next to Save that returns to the read-only view, whether or not anything was saved first. */
  onDone?: () => void;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [seasonsEnabled, setSeasonsEnabled] = useState(settings.seasons_enabled);
  const [seasonLength, setSeasonLength] = useState<SeasonLength>(settings.season_length ?? 'manual');
  const [timezone, setTimezone] = useState(settings.timezone);
  const [bettingEnabled, setBettingEnabled] = useState(settings.betting_enabled);
  const [acceptingMembers, setAcceptingMembers] = useState(settings.accepting_members);
  const [distributePayout, setDistributePayout] = useState(settings.distribute_payout);
  const [creatorPayoutPct, setCreatorPayoutPct] = useState(settings.creator_payout_pct);
  const [endorserPayoutPct, setEndorserPayoutPct] = useState(settings.endorser_payout_pct);

  function handleSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await updateGroupSettings(groupId, {
        seedAmount: Number(formData.get('seedAmount')),
        seasonsEnabled,
        seasonLength: seasonsEnabled ? seasonLength : null,
        timezone,
        bettingEnabled,
        acceptingMembers,
        distributePayout,
        creatorPayoutPct,
        endorserPayoutPct,
      });
      if (result.error) {
        setError(result.error);
      } else {
        router.refresh();
        onDone?.();
      }
    });
  }

  return (
    <form action={handleSubmit} className="space-y-4">
      {error && <p className="text-sm text-danger-700">{error}</p>}

      <div className="flex items-center justify-between rounded-xl bg-honey-50 px-4 py-3">
        <div>
          <p className="text-sm font-semibold text-espresso-800">Betting</p>
          <p className="text-xs text-espresso-500">
            {bettingEnabled ? 'Members can create markets.' : 'Off by default. Turn on when your group is ready.'}
          </p>
        </div>
        <Switch checked={bettingEnabled} onChange={() => setBettingEnabled((v) => !v)} />
      </div>

      <div className="space-y-1.5">
        <label className="block text-sm font-semibold text-espresso-700">Token allocation</label>
        <input name="seedAmount" type="number" min={1} defaultValue={settings.seed_amount} required className={inputClasses} />
        <p className="text-xs text-espresso-400">
          Never changes anyone's current balance. Applies to new members joining from now on
          {settings.seasons_enabled ? ', and to everyone once the next season starts.' : '.'}
        </p>
      </div>

      <div className="space-y-2 border-t border-espresso-100 pt-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-espresso-700">Split universal losses</p>
            <p className="text-xs text-espresso-400">
              {distributePayout
                ? "When everyone loses in a market, split that pool between the creator, the endorser, and the group's other open markets instead of refunding it."
                : "Off by default: when everyone loses in a market, everyone gets their stake back."}
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
            <label className="flex-1 space-y-1">
              <span className="text-xs font-semibold text-espresso-500">Endorser %</span>
              <input
                type="number"
                min={0}
                max={100}
                value={endorserPayoutPct}
                onChange={(e) => setEndorserPayoutPct(Number(e.target.value))}
                className={inputClasses}
              />
            </label>
          </div>
        )}
        {distributePayout && creatorPayoutPct + endorserPayoutPct > 100 && (
          <p className="text-xs text-danger-700">Creator and endorser percentages can't add up to more than 100.</p>
        )}
      </div>

      <div className="space-y-1.5 border-t border-espresso-100 pt-4">
        <label className="block text-sm font-semibold text-espresso-700">Time zone</label>
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
        <p className="text-xs text-espresso-400">Shown next to betting-closes times so everyone knows what zone you meant.</p>
      </div>

      <div className="flex items-center justify-between border-t border-espresso-100 pt-4">
        <div>
          <p className="text-sm font-semibold text-espresso-700">Accepting new members</p>
          <p className="text-xs text-espresso-400">
            {acceptingMembers ? 'Anyone with the invite code can join.' : 'The invite code is live but joining is paused.'}
          </p>
        </div>
        <Switch checked={acceptingMembers} onChange={() => setAcceptingMembers((v) => !v)} />
      </div>

      <div className="space-y-2 border-t border-espresso-100 pt-4">
        <div className="flex items-center justify-between">
          <label className="text-sm font-semibold text-espresso-700">Seasons</label>
          <Switch checked={seasonsEnabled} onChange={() => setSeasonsEnabled((v) => !v)} disabled={settings.seasons_enabled} />
        </div>
        {settings.seasons_enabled && <p className="text-xs text-espresso-400">Seasons can't be turned off once enabled.</p>}

        {seasonsEnabled && (
          <div className="flex flex-wrap gap-2 pt-1">
            {(['1m', '2m', '3m', 'manual'] as SeasonLength[]).map((len) => (
              <button
                type="button"
                key={len}
                onClick={() => setSeasonLength(len)}
                className={`rounded-full border px-3 py-1 text-sm font-semibold ${
                  seasonLength === len ? 'border-honey-500 bg-honey-50 text-honey-800' : 'border-espresso-200 text-espresso-600'
                }`}
              >
                {formatSeasonLength(len)}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex gap-2">
        {onDone && (
          <Button type="button" variant="outline" onClick={onDone} className="flex-1">
            Done
          </Button>
        )}
        <Button
          type="submit"
          disabled={isPending || (distributePayout && creatorPayoutPct + endorserPayoutPct > 100)}
          className="flex-1"
        >
          Save settings
        </Button>
      </div>
    </form>
  );
}

const readOnlyRowClasses = 'flex items-center justify-between gap-4 py-2';

/** Read-only view of the same settings the owner sees, used both for non-owners and as the owner's default (pre-Edit) view. */
export function ReadOnlySettings({ settings, hasActiveSeason }: { settings: GroupSettings; hasActiveSeason: boolean }) {
  return (
    <div className="divide-y divide-espresso-100 text-sm">
      <div className={readOnlyRowClasses}>
        <span className="text-espresso-500">Betting</span>
        <span className="font-semibold text-espresso-800">{settings.betting_enabled ? 'Open' : 'Not open yet'}</span>
      </div>
      <div className={readOnlyRowClasses}>
        <span className="text-espresso-500">Token allocation</span>
        <span className="font-semibold text-espresso-800">{settings.seed_amount}</span>
      </div>
      <div className={readOnlyRowClasses}>
        <span className="text-espresso-500">Time zone</span>
        <span className="font-semibold text-espresso-800">{friendlyTimezoneName(settings.timezone)}</span>
      </div>
      <div className={readOnlyRowClasses}>
        <span className="text-espresso-500">Seasons</span>
        <span className="font-semibold text-espresso-800">
          {settings.seasons_enabled
            ? `${formatSeasonLength((settings.season_length ?? 'manual') as SeasonLength)}${hasActiveSeason ? '' : ' (between seasons)'}`
            : 'Off'}
        </span>
      </div>
      <div className={readOnlyRowClasses}>
        <span className="text-espresso-500">Payout on universal losses</span>
        <span className="font-semibold text-espresso-800">
          {settings.distribute_payout
            ? `Creator ${settings.creator_payout_pct}%, endorser ${settings.endorser_payout_pct}%, rest to other markets`
            : 'Refunded to everyone'}
        </span>
      </div>
    </div>
  );
}

/** The owner's settings card: view-only by default (same component non-owners see), with an Edit button that swaps in the form. */
export function OwnerSettingsPanel({
  groupId,
  settings,
  hasActiveSeason,
}: {
  groupId: string;
  settings: GroupSettings;
  hasActiveSeason: boolean;
}) {
  const [isEditing, setIsEditing] = useState(false);

  if (!isEditing) {
    return (
      <div className="space-y-3">
        <ReadOnlySettings settings={settings} hasActiveSeason={hasActiveSeason} />
        <Button variant="outline" className="w-full" onClick={() => setIsEditing(true)}>
          Edit settings
        </Button>
      </div>
    );
  }

  return <EditSettingsForm groupId={groupId} settings={settings} onDone={() => setIsEditing(false)} />;
}

export function RegenerateCodeButton({ groupId }: { groupId: string }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  return (
    <div>
      {error && <p className="mb-2 text-sm text-danger-700">{error}</p>}
      <Button
        variant="outline"
        size="sm"
        disabled={isPending}
        onClick={() =>
          startTransition(async () => {
            const result = await regenerateInviteCode(groupId);
            if (result.error) {
              setError(result.error);
            } else {
              router.refresh();
            }
          })
        }
      >
        Regenerate code
      </Button>
    </div>
  );
}

export function RemoveMemberButton({ groupId, userId, nickname }: { groupId: string; userId: string; nickname: string }) {
  const [isPending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  if (!confirming) {
    return (
      <button onClick={() => setConfirming(true)} className="text-sm font-medium text-danger-700 hover:underline">
        Remove
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2 text-sm">
      {error && <span className="text-danger-700">{error}</span>}
      <span className="text-espresso-500">
        Remove <Mention nickname={nickname} />?
      </span>
      <button
        disabled={isPending}
        onClick={() =>
          startTransition(async () => {
            const result = await removeMember(groupId, userId);
            if (result.error) {
              setError(result.error);
              setConfirming(false);
            } else {
              router.refresh();
            }
          })
        }
        className="font-semibold text-danger-700"
      >
        Confirm
      </button>
      <button onClick={() => setConfirming(false)} className="text-espresso-400">
        Cancel
      </button>
    </div>
  );
}

export function TransferOwnershipForm({ groupId, members }: { groupId: string; members: { userId: string; nickname: string }[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  if (members.length === 0) {
    return <p className="text-sm text-espresso-400">No other active members to hand this off to yet.</p>;
  }

  const selectedNickname = members.find((m) => m.userId === selected)?.nickname;

  return (
    <div className="space-y-2">
      {error && <p className="text-sm text-danger-700">{error}</p>}
      <select
        value={selected}
        onChange={(e) => {
          setSelected(e.target.value);
          setConfirming(false);
        }}
        className={inputClasses}
      >
        <option value="">Choose a member…</option>
        {members.map((m) => (
          <option key={m.userId} value={m.userId}>
            @{m.nickname}
          </option>
        ))}
      </select>

      {selected && !confirming && (
        <Button variant="outline" className="w-full" onClick={() => setConfirming(true)}>
          Make <Mention nickname={selectedNickname ?? ''} /> the owner
        </Button>
      )}

      {selected && confirming && (
        <div className="space-y-2 rounded-xl bg-danger-50 p-3">
          <p className="text-sm text-danger-700">
            You'll become a regular member of your own group. Only <Mention nickname={selectedNickname ?? ''} /> could
            transfer it back.
          </p>
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              className="flex-1"
              disabled={isPending}
              onClick={() =>
                startTransition(async () => {
                  const result = await transferOwnership(groupId, selected);
                  if (result.error) {
                    setError(result.error);
                    setConfirming(false);
                  } else {
                    router.refresh();
                  }
                })
              }
            >
              Confirm transfer
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export function DeleteGroupButton({ groupId, groupName }: { groupId: string; groupName: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  if (!confirming) {
    return (
      <Button variant="danger" className="w-full" onClick={() => setConfirming(true)}>
        Delete this group
      </Button>
    );
  }

  return (
    <div className="space-y-2">
      {error && <p className="text-sm text-danger-700">{error}</p>}
      <p className="text-sm text-espresso-600">
        This permanently deletes every market, bet, and balance in {groupName} for everyone. Type the group name to
        confirm.
      </p>
      <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={groupName} className={inputClasses} />
      <div className="flex gap-2">
        <Button
          variant="outline"
          className="flex-1"
          onClick={() => {
            setConfirming(false);
            setTyped('');
          }}
        >
          Cancel
        </Button>
        <Button
          variant="danger"
          className="flex-1"
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
          Delete forever
        </Button>
      </div>
    </div>
  );
}

export function EndSeasonButton({ groupId }: { groupId: string }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  return (
    <div>
      {error && <p className="mb-2 text-sm text-danger-700">{error}</p>}
      <Button
        variant="danger"
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
        End season now
      </Button>
    </div>
  );
}
