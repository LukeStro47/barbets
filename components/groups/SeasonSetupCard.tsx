'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { ConsequenceRow } from '@/components/ui/ConsequenceRow';
import { SeasonSetupEditSheet, type RosterMember } from '@/components/groups/SeasonSetupEditSheet';
import { formatTokens } from '@/lib/formatNumber';
import { formatSeasonLength, type SeasonLength } from '@/lib/seasonLength';
import type { GroupSettings } from '@/lib/actions/groups';

/**
 * Owner-only. Configure opens SeasonSetupEditSheet rather than starting the season directly —
 * name, length, reseed amount, and the roster are all things that are only changeable *now*, one
 * tap away, so the button that moves you forward is the same one that surfaces them, rather than
 * a silent "starts with whatever's already set" action next to a separate, easy-to-miss Edit. The
 * two rows below read as what happens *when* you do (a ConsequenceRow pair, same connected-dot
 * grammar as a confirmation modal's "what this does"), not just a snapshot of current state.
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
      <div className="flex flex-col gap-3 px-4 py-4">
        <p className="text-[11.5px] leading-[1.35] text-espresso-400">
          {seasonName ?? `Season ${nextSeasonNumber}`} · {formatSeasonLength(seasonLength)} · {formatTokens(settings.seed_amount)} each
        </p>
        <div>
          <ConsequenceRow dotClassName="bg-honey-500">
            <strong className="font-bold text-espresso-900">{playingCount} playing</strong>
            {sittingOutLabel && `, ${sittingOutLabel}`}
          </ConsequenceRow>
          <ConsequenceRow dotClassName="bg-espresso-200" isLast>
            Everyone reseeded to <strong className="font-bold text-espresso-900">{formatTokens(settings.seed_amount)}</strong> when you
            start
          </ConsequenceRow>
        </div>
        <Button size="lg" className="w-full" onClick={() => setEditOpen(true)}>
          Configure
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
