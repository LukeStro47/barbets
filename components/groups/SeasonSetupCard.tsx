'use client';

import { useState } from 'react';
import { SeasonSetupEditSheet, type RosterMember } from '@/components/groups/SeasonSetupEditSheet';
import { StickyFooter, FooterButton } from '@/components/ui/Screen';
import type { GroupSettings } from '@/lib/actions/groups';

/**
 * Owner-only, on 5n: "Configure Season N" in the footer, which opens SeasonSetupEditSheet — name,
 * length, reseed and roster are only changeable now, so the button that moves you forward is the
 * one that surfaces them. (The dashed "Season N setup" summary card that used to sit above it was
 * removed at the user's request; the sheet shows the same roster and reseed.)
 */
export function SeasonSetupCard({
  groupId,
  seasonId,
  nextSeasonNumber,
  seasonName,
  settings,
  members,
  playingCount,
}: {
  groupId: string;
  seasonId: string;
  nextSeasonNumber: number;
  seasonName: string | null;
  settings: GroupSettings;
  members: RosterMember[];
  playingCount: number;
}) {
  const [editOpen, setEditOpen] = useState(false);

  return (
    <>
      {/* The intermission hub keeps BottomNav, so this footer has to sit above it. */}
      <StickyFooter aboveNav>
        <FooterButton onClick={() => setEditOpen(true)}>Configure {seasonName ?? `Season ${nextSeasonNumber}`}</FooterButton>
      </StickyFooter>

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
    </>
  );
}
