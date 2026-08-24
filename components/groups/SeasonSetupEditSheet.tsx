'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Mention } from '@/components/ui/Mention';
import { SeasonNameEditor } from '@/components/groups/SeasonNameEditor';
import { RemoveMemberButton, TransferOwnershipSheet } from '@/components/groups/SettingsActions';
import { updateGroupSettings, type GroupSettings } from '@/lib/actions/groups';
import { formatTokenInputValue } from '@/lib/formatNumber';
import { TOKEN_ALLOCATION_MAX } from '@/lib/limits';
import { SEASON_LENGTH_SHORT_LABEL, type SeasonLength } from '@/lib/seasonLength';
import { cn } from '@/lib/cn';

export interface RosterMember {
  userId: string;
  nickname: string;
  status: 'active' | 'dormant';
  isOwner: boolean;
}

const LENGTH_OPTIONS: SeasonLength[] = ['1m', '2m', '3m', 'manual', 'custom'];

/** datetime-local wants "YYYY-MM-DDTHH:mm" in the browser's local time, not UTC — same helper
 * EditSettingsForm uses for the same field. */
function toLocalDatetimeInputValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * Owner-only sheet opened from SeasonSetupCard's "Edit" pill — name, length, reseed amount, and
 * the roster (boot + transfer ownership), all without leaving the group hub. `update_group_settings`
 * is a full-object RPC, not a patch, so `save()` below submits every field from `settings`
 * unchanged except the two this sheet actually edits — same pattern EditSettingsForm uses on
 * /settings/edit.
 */
export function SeasonSetupEditSheet({
  groupId,
  seasonId,
  seasonName,
  seasonNumber,
  settings,
  members,
  onClose,
}: {
  groupId: string;
  seasonId: string;
  seasonName: string | null;
  seasonNumber: number;
  settings: GroupSettings;
  members: RosterMember[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [seedAmount, setSeedAmount] = useState(() => formatTokenInputValue(String(settings.seed_amount)));
  const [seasonLength, setSeasonLength] = useState<SeasonLength>((settings.season_length ?? 'manual') as SeasonLength);
  const [seasonCustomEndsAt, setSeasonCustomEndsAt] = useState(() =>
    toLocalDatetimeInputValue(settings.season_custom_ends_at ? new Date(settings.season_custom_ends_at) : new Date(Date.now() + 24 * 60 * 60_000))
  );
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [transferOpen, setTransferOpen] = useState(false);

  const dirty =
    seedAmount.replace(/,/g, '') !== String(settings.seed_amount) ||
    seasonLength !== (settings.season_length ?? 'manual') ||
    (seasonLength === 'custom' && new Date(seasonCustomEndsAt).toISOString() !== settings.season_custom_ends_at);

  function save() {
    setError(null);
    startTransition(async () => {
      const result = await updateGroupSettings(groupId, {
        seedAmount: Number(seedAmount.replace(/,/g, '')) || settings.seed_amount,
        seasonsEnabled: settings.seasons_enabled,
        seasonLength,
        seasonCustomEndsAt: seasonLength === 'custom' ? new Date(seasonCustomEndsAt).toISOString() : null,
        timezone: settings.timezone,
        bettingEnabled: settings.betting_enabled,
        acceptingMembers: settings.accepting_members,
        distributePayout: settings.distribute_payout,
        creatorPayoutPct: settings.creator_payout_pct,
        allowHedgedBets: settings.allow_hedged_bets,
        resolutionWindowHours: settings.resolution_window_hours,
        requireEndorsement: settings.require_endorsement,
        joinMessage: settings.join_message,
      });
      if (result.error) {
        setError(result.error);
      } else {
        setSaved(true);
        router.refresh();
      }
    });
  }

  const removableMembers = members.filter((m) => !m.isOwner);
  const transferTargets = members.filter((m) => !m.isOwner && m.status === 'active').map((m) => ({ userId: m.userId, nickname: m.nickname }));

  return (
    <Modal onClose={onClose} padded={false} panelClassName="max-w-sm rounded-2xl">
      <div className="max-h-[80vh] overflow-y-auto p-5">
        <p className="font-display text-lg font-extrabold tracking-[-0.015em] text-espresso-950">Season {seasonNumber} setup</p>

        <div className="mt-4 space-y-1.5">
          <p className="text-xs font-bold text-espresso-500">Name</p>
          <SeasonNameEditor groupId={groupId} seasonId={seasonId} currentName={seasonName} seasonNumber={seasonNumber} />
        </div>

        <div className="mt-4 space-y-2">
          <p className="text-xs font-bold text-espresso-500">Length</p>
          <div className="flex flex-wrap gap-1.5">
            {LENGTH_OPTIONS.map((len) => (
              <button
                key={len}
                type="button"
                onClick={() => setSeasonLength(len)}
                className={cn(
                  'rounded-full px-3 py-1.5 text-[12.5px] font-bold transition-colors',
                  seasonLength === len
                    ? 'bg-espresso-900 text-paper-white'
                    : 'border border-espresso-200 text-espresso-700 hover:bg-espresso-50'
                )}
              >
                {SEASON_LENGTH_SHORT_LABEL[len]}
              </button>
            ))}
          </div>
          {seasonLength === 'custom' && (
            <input
              type="datetime-local"
              value={seasonCustomEndsAt}
              onChange={(e) => setSeasonCustomEndsAt(e.target.value)}
              className="w-full rounded-[10px] border border-espresso-200 bg-paper-white px-3 py-2 text-sm font-semibold text-espresso-950 focus:border-honey-500 focus:ring-2 focus:ring-honey-200 focus:outline-none"
            />
          )}
        </div>

        <div className="mt-4 space-y-1.5">
          <label className="block text-xs font-bold text-espresso-500" htmlFor="setup-seed-amount">
            Reseed each member with
          </label>
          <input
            id="setup-seed-amount"
            type="text"
            inputMode="numeric"
            value={seedAmount}
            onChange={(e) => setSeedAmount(formatTokenInputValue(e.target.value, TOKEN_ALLOCATION_MAX))}
            className="w-full rounded-[10px] border border-espresso-200 bg-paper-white px-3 py-2 text-sm font-bold text-espresso-950 focus:border-honey-500 focus:ring-2 focus:ring-honey-200 focus:outline-none"
          />
        </div>

        {error && <p className="mt-3 text-sm text-danger-700">{error}</p>}
        <div className="mt-3 flex gap-2">
          <Button type="button" variant="outline" size="sm" className="flex-1" onClick={onClose}>
            {saved ? 'Done' : 'Cancel'}
          </Button>
          <Button type="button" size="sm" className="flex-1" disabled={isPending || !dirty} onClick={save}>
            {isPending ? 'Saving…' : saved ? 'Saved ✓' : 'Save'}
          </Button>
        </div>

        <div className="mt-5 border-t border-espresso-100 pt-4">
          <p className="text-xs font-bold text-espresso-500">Roster</p>
          <p className="mt-1 text-[11.5px] leading-[1.4] text-espresso-400">
            Removing someone here removes them from the group entirely, not just the next season. They can&apos;t rejoin.
          </p>
          <div className="mt-2.5 divide-y divide-espresso-50 rounded-[14px] border border-espresso-100">
            {removableMembers.map((m) => (
              <div key={m.userId} className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                <span className="min-w-0 truncate text-sm text-espresso-800">
                  <Mention nickname={m.nickname} className="font-semibold" />
                  {m.status === 'dormant' && <span className="ml-1.5 text-[11.5px] text-espresso-400">dormant</span>}
                </span>
                <RemoveMemberButton groupId={groupId} userId={m.userId} nickname={m.nickname} />
              </div>
            ))}
            {removableMembers.length === 0 && <p className="px-3.5 py-2.5 text-sm text-espresso-400">Nobody else in the group yet.</p>}
          </div>
          <button
            type="button"
            onClick={() => setTransferOpen(true)}
            className="mt-2.5 w-full rounded-[14px] border border-espresso-200 px-3.5 py-2.5 text-left text-sm font-semibold text-espresso-800 hover:bg-espresso-50"
          >
            Transfer ownership
            <span className="mt-0.5 block text-[11.5px] font-normal text-espresso-400">You stay in the group as a regular member.</span>
          </button>
        </div>
      </div>

      {transferOpen && <TransferOwnershipSheet groupId={groupId} members={transferTargets} onClose={() => setTransferOpen(false)} />}
    </Modal>
  );
}
