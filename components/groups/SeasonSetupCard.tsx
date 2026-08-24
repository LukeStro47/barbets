'use client';

import { useState } from 'react';
import { ContinueButton } from '@/components/groups/IntermissionActions';
import { SeasonSetupEditSheet, type RosterMember } from '@/components/groups/SeasonSetupEditSheet';
import { formatTokens } from '@/lib/formatNumber';
import { formatSeasonLength, type SeasonLength } from '@/lib/seasonLength';
import type { GroupSettings } from '@/lib/actions/groups';

/**
 * Owner-only. The chip row is read-only display of the next season's config; every actual
 * control — rename, length/reseed, roster (including boot + transfer ownership) — lives one
 * tap away in SeasonSetupEditSheet, so this card stays a decision summary rather than a form.
 */
export function SeasonSetupCard({
  groupId,
  seasonId,
  nextSeasonNumber,
  seasonName,
  settings,
  members,
  playingCount,
  sittingOutLabel,
}: {
  groupId: string;
  seasonId: string;
  nextSeasonNumber: number;
  seasonName: string | null;
  settings: GroupSettings;
  members: RosterMember[];
  playingCount: number;
  /** e.g. "@tom out" or "2 out" — precomputed so this card doesn't need the full roster shape. */
  sittingOutLabel: string | null;
}) {
  const [editOpen, setEditOpen] = useState(false);
  const seasonLength = (settings.season_length ?? 'manual') as SeasonLength;

  return (
    <div className="overflow-hidden rounded-[24px] border-[1.5px] border-honey-500 bg-paper-white">
      <div className="flex items-center gap-2 bg-honey-50 px-3.5 py-2">
        <span className="h-[7px] w-[7px] shrink-0 rounded-full bg-honey-500" />
        <p className="flex-1 text-xs font-extrabold tracking-[0.06em] text-honey-800 uppercase">Season {nextSeasonNumber} setup</p>
      </div>
      <div className="flex flex-col gap-2.5 px-4 py-4">
        <div className="flex flex-wrap gap-1.5">
          <span className="rounded-full bg-espresso-50 px-2.5 py-1 text-xs font-bold text-espresso-700">
            {seasonName ?? `Season ${nextSeasonNumber}`}
          </span>
          <span className="rounded-full bg-espresso-50 px-2.5 py-1 text-xs font-bold text-espresso-700">
            {formatSeasonLength(seasonLength)}
          </span>
          <span className="rounded-full bg-espresso-50 px-2.5 py-1 text-xs font-bold text-espresso-700">
            {formatTokens(settings.seed_amount)} each
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="min-w-0 flex-1">
            <span className="block text-[13.5px] font-extrabold text-espresso-950">
              {playingCount} playing{sittingOutLabel && `, ${sittingOutLabel}`}
            </span>
            <span className="block text-[11.5px] leading-[1.35] text-espresso-400">Everyone reseeded when you start</span>
          </span>
          <button
            type="button"
            onClick={() => setEditOpen(true)}
            className="shrink-0 rounded-full border border-espresso-200 px-3 py-[7px] text-[12.5px] font-bold text-espresso-800 hover:bg-espresso-50"
          >
            Edit
          </button>
        </div>
        <ContinueButton groupId={groupId} playingCount={playingCount} />
        <p className="text-center text-[11.5px] text-espresso-400">Betting stays paused until you open it.</p>
      </div>

      {editOpen && (
        <SeasonSetupEditSheet
          groupId={groupId}
          seasonId={seasonId}
          seasonName={seasonName}
          seasonNumber={nextSeasonNumber}
          settings={settings}
          members={members}
          onClose={() => setEditOpen(false)}
        />
      )}
    </div>
  );
}
