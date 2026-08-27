'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { SeasonSetupEditSheet, type RosterMember } from '@/components/groups/SeasonSetupEditSheet';
import type { GroupSettings } from '@/lib/actions/groups';

/**
 * Owner-only. Continue opens SeasonSetupEditSheet rather than starting the season directly —
 * name, length, reseed amount, and the roster are all things that are only changeable *now*, one
 * tap away, so the button that moves you forward is the same one that surfaces them, rather than
 * a silent "starts with whatever's already set" action next to a separate, easy-to-miss Edit.
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

  return (
    <div className="overflow-hidden rounded-[24px] border-[1.5px] border-honey-500 bg-paper-white">
      <div className="flex items-center gap-2 bg-honey-50 px-3.5 py-2">
        <span className="h-[7px] w-[7px] shrink-0 rounded-full bg-honey-500" />
        <p className="flex-1 text-xs font-extrabold tracking-[0.06em] text-honey-800 uppercase">Season {nextSeasonNumber} setup</p>
      </div>
      <div className="flex flex-col gap-2.5 px-4 py-4">
        <div>
          <p className="text-[13.5px] font-extrabold text-espresso-950">
            {playingCount} playing{sittingOutLabel && `, ${sittingOutLabel}`}
          </p>
          <p className="text-[11.5px] leading-[1.35] text-espresso-400">Everyone reseeded when you start</p>
        </div>
        <Button size="lg" className="w-full" onClick={() => setEditOpen(true)}>
          Continue
        </Button>
      </div>

      {editOpen && (
        <SeasonSetupEditSheet
          groupId={groupId}
          seasonId={seasonId}
          seasonName={seasonName}
          seasonNumber={nextSeasonNumber}
          settings={settings}
          members={members}
          playingCount={playingCount}
          onClose={() => setEditOpen(false)}
        />
      )}
    </div>
  );
}
