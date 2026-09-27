'use client';

import { useState } from 'react';
import { SeasonSetupEditSheet, type RosterMember } from '@/components/groups/SeasonSetupEditSheet';
import { StickyFooter, FooterButton } from '@/components/ui/Screen';
import { formatTokens, numberWordCapitalized } from '@/lib/formatNumber';
import type { GroupSettings } from '@/lib/actions/groups';

/**
 * Owner-only, on 5n: the next season's setup as one dashed card ("Eight playing, @tom out.
 * Everyone reseeded to 1,000 when you start.") and "Configure Season N" in the footer, which
 * opens SeasonSetupEditSheet — name, length, reseed and roster are only changeable now, so the
 * button that moves you forward is the one that surfaces them.
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
  /** e.g. "@tom out" or "2 out". */
  sittingOutLabel: string | null;
}) {
  const [editOpen, setEditOpen] = useState(false);

  return (
    <>
      <div className="rounded-[18px] border border-dashed border-dash bg-surface px-4 py-[15px]">
        <p className="text-[13px] font-bold text-ink">{seasonName ?? `Season ${nextSeasonNumber}`} setup</p>
        <p className="mt-1.5 text-[12.5px] leading-[1.5] text-muted text-pretty">
          {numberWordCapitalized(playingCount)} playing{sittingOutLabel ? `, ${sittingOutLabel}` : ''}. Everyone reseeded to{' '}
          {formatTokens(settings.seed_amount)} when you start.
        </p>
      </div>

      <StickyFooter>
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
