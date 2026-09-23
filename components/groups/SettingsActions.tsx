'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { removeMember, transferOwnership, deleteGroup } from '@/lib/actions/groups';
import { endSeason } from '@/lib/actions/seasons';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { ConsequenceRow } from '@/components/ui/ConsequenceRow';
import { SectionLabel, SettingsCard, NavRowContent, settingsNavRowClasses } from '@/components/ui/SettingsList';
import { AlertTriangleIcon } from '@/components/ui/icons';
import { SeasonNameEditor } from '@/components/groups/SeasonNameEditor';
import { Mention } from '@/components/ui/Mention';

const selectClasses =
  'w-full rounded-[10px] border border-hairline bg-surface px-3.5 py-2.5 text-[15px] font-semibold text-ink focus:border-signal focus:outline-none focus:ring-2 focus:ring-signal/15';

export function RemoveMemberButton({ groupId, userId, nickname }: { groupId: string; userId: string; nickname: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  return (
    <>
      <button type="button" onClick={() => setConfirming(true)} className="text-[13px] font-semibold text-alert hover:underline">
        Remove
      </button>

      {confirming && (
        <Modal onClose={() => setConfirming(false)}>
          <p className="font-display text-lg font-extrabold tracking-[-0.015em] text-ink">
            Remove <Mention nickname={nickname} />?
          </p>
          {error && <p className="text-sm text-alert">{error}</p>}
          <div className="pt-0.5">
            <ConsequenceRow dotClassName="bg-alert">Their open bets are refunded and they lose access straight away.</ConsequenceRow>
            <ConsequenceRow dotClassName="bg-ink">The invite code rotates, so their copy of it stops working.</ConsequenceRow>
            <ConsequenceRow dotClassName="bg-dash" isLast>
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
  isPublic = false,
  heading = true,
}: {
  groupId: string;
  groupName: string;
  resolutionWindowHours: number;
  activeSeason: { id: string; number: number; name: string | null } | null;
  /** Every active member other than the owner for a private group; moderators only for a public
      one (transfer_ownership() requires it — see TransferOwnershipSheet). */
  members: { userId: string; nickname: string }[];
  deletionScheduled: boolean;
  isPublic?: boolean;
  heading?: boolean;
}) {
  const [openSheet, setOpenSheet] = useState<null | 'end-season' | 'transfer' | 'delete'>(null);

  return (
    <section>
      {heading && <SectionLabel>Owner only</SectionLabel>}
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
      {openSheet === 'transfer' && (
        <TransferOwnershipSheet groupId={groupId} members={members} onClose={() => setOpenSheet(null)} isPublic={isPublic} />
      )}
      {openSheet === 'delete' && <DeleteGroupSheet groupId={groupId} groupName={groupName} onClose={() => setOpenSheet(null)} />}
    </section>
  );
}

/** The season name is what gets archived to Awards, so the moment you're about to end the season
 *  is the last chance to make it read as anything other than "Season 3" before that's permanent.
 *  It's also editable from GroupIdentitySheet on Manage group. Reused from Owner tools and from
 *  Group rules when season length is "I end it". */
export function EndSeasonSheet({
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
      <p className="font-display text-lg font-extrabold tracking-[-0.015em] text-ink">
        End {season.name ?? `Season ${season.number}`}?
      </p>
      {error && <p className="text-sm text-alert">{error}</p>}
      <div className="pt-0.5">
        <ConsequenceRow dotClassName="bg-alert">
          Every market without a proposed result is voided and refunded.
        </ConsequenceRow>
        <ConsequenceRow dotClassName="bg-ink">
          Anything already awaiting a challenge or a vote gets up to {resolutionWindowHours} more hours to finish.
        </ConsequenceRow>
        <ConsequenceRow dotClassName="bg-dash" isLast>
          Standings archive to Awards, then intermission opens and everyone is reseeded for the next one.
        </ConsequenceRow>
      </div>

      <div className="rounded-[10px] border border-hairline bg-canvas p-3">
        <p className="mb-1.5 text-xs font-bold text-muted">This season&apos;s name is what shows up in Awards.</p>
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

export function TransferOwnershipSheet({
  groupId,
  members,
  onClose,
  isPublic = false,
}: {
  groupId: string;
  members: { userId: string; nickname: string }[];
  onClose: () => void;
  /** Public-group ownership can only pass to an existing moderator — see transfer_ownership()'s
      migration. The page already filters `members` down to moderators-only when this is true;
      this prop only changes the copy so the empty state points at the actual fix (assign a
      moderator first) instead of the generic "no other members yet". */
  isPublic?: boolean;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const selectedNickname = members.find((m) => m.userId === selected)?.nickname;

  return (
    <Modal onClose={onClose}>
      <p className="font-display text-lg font-extrabold tracking-[-0.015em] text-ink">
        {selectedNickname ? (
          <>
            Hand the group to <Mention nickname={selectedNickname} />?
          </>
        ) : (
          'Hand the group to someone else?'
        )}
      </p>
      {error && <p className="text-sm text-alert">{error}</p>}

      {members.length === 0 ? (
        <>
          <p className="text-sm leading-[1.55] text-muted">
            {isPublic
              ? "There's no other moderator yet. Assign one from the admin console first, then come back here to hand it off."
              : "There's nobody to hand it to yet. Only active members other than you can take it on."}
          </p>
          <Button type="button" variant="outline" className="w-full" onClick={onClose}>
            Close
          </Button>
        </>
      ) : (
        <>
          <p className="text-sm leading-[1.55] text-muted">
            {isPublic
              ? 'You stay on as a moderator. '
              : 'You stay in the group as a regular member. '}
            From then on only {selectedNickname ? <Mention nickname={selectedNickname} /> : 'they'} can change how the group
            plays, remove people, or transfer it back.
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
      <span className="flex h-[38px] w-[38px] items-center justify-center rounded-full bg-alert-bg">
        <AlertTriangleIcon className="h-5 w-5 text-alert" />
      </span>
      <p className="font-display text-lg font-extrabold tracking-[-0.015em] text-ink">Delete {groupName}?</p>
      {error && <p className="text-sm text-alert">{error}</p>}
      <div className="pt-0.5">
        <ConsequenceRow dotClassName="bg-alert">Every open market is voided and refunded first.</ConsequenceRow>
        <ConsequenceRow dotClassName="bg-ink">The group disappears immediately, for everyone.</ConsequenceRow>
        <ConsequenceRow dotClassName="bg-dash" isLast>
          Awards, seasons and history go with it. This can&apos;t be undone.
        </ConsequenceRow>
      </div>

      <div className="space-y-1.5">
        <label className="block text-xs font-bold text-muted" htmlFor="delete-confirm">
          Type the group name to confirm
        </label>
        <input
          id="delete-confirm"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          placeholder={groupName}
          className="w-full rounded-[10px] border border-hairline bg-surface px-3.5 py-2.5 text-sm text-ink focus:border-signal focus:outline-none focus:ring-2 focus:ring-signal/15"
        />
      </div>

      <div className="flex gap-2 pt-1">
        <Button type="button" variant="outline" className="flex-1" onClick={onClose}>
          Cancel
        </Button>
        <Button
          type="button"
          variant="danger"
          className="flex-1 disabled:bg-alert-bg disabled:text-alert"
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
