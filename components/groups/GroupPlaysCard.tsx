import { SettingsCard, SettingRow, StatusPill } from '@/components/ui/SettingsList';
import { formatTokens } from '@/lib/formatNumber';
import { friendlyTimezoneName } from '@/lib/timezone';
import { formatSeasonLength, type SeasonLength } from '@/lib/seasonLength';
import type { GroupSettings } from '@/lib/actions/groups';

export interface ActiveSeasonSummary {
  number: number;
  name: string | null;
  bettingOpen: boolean;
}

/** "Season 2, Fall Run" — or just "Season 2" while it's unnamed. */
export function seasonLabel(season: ActiveSeasonSummary): string {
  return season.name ? `Season ${season.number}, ${season.name}` : `Season ${season.number}`;
}

/** The short "Season 2" form, for the middle of a sentence. */
function seasonShortLabel(season: ActiveSeasonSummary): string {
  return `Season ${season.number}`;
}

/**
 * The eight rows that say how a group plays, identical in structure for the owner and for a member
 * and differing only in person: an owner reads about what members can do, a member reads about what
 * *they* can do. Two copies of the same list would drift the moment one of them was edited, so the
 * person is a parameter rather than a second component.
 *
 * Nothing here is a control. Editing lives at /groups/[groupId]/settings/edit, which shows the same
 * list with the right-hand side swapped for inputs.
 */
export function GroupPlaysCard({
  settings,
  season,
  isOwner,
}: {
  settings: GroupSettings;
  /** The currently active season, or null when there isn't one (seasons off, or between seasons). */
  season: ActiveSeasonSummary | null;
  isOwner: boolean;
}) {
  const you = !isOwner;

  // Betting: for a seasons-enabled group the season's own switch is the real gate, and
  // settings.betting_enabled stops mattering entirely once the first season starts.
  let bettingValue: string;
  let bettingConsequence: string;
  if (settings.seasons_enabled) {
    if (!season) {
      bettingValue = 'Between seasons';
      bettingConsequence = 'Nothing can be started or bet on until the next season begins.';
    } else if (season.bettingOpen) {
      bettingValue = 'Open';
      bettingConsequence = `${seasonShortLabel(season)} is live, so ${you ? 'you' : 'anyone'} can start a market.`;
    } else {
      bettingValue = 'Not open yet';
      bettingConsequence = isOwner
        ? `${seasonShortLabel(season)} has started, but betting is still paused. Open it from the group page.`
        : `${seasonShortLabel(season)} has started, but the owner hasn't opened betting yet.`;
    }
  } else if (settings.betting_enabled) {
    bettingValue = 'Open';
    bettingConsequence = `${you ? 'You' : 'Anyone'} can start a market.`;
  } else {
    bettingValue = 'Not open yet';
    bettingConsequence = isOwner
      ? "Nobody can start a market until you turn betting on. That switch only goes one way."
      : 'Nobody can start a market until the owner turns betting on.';
  }

  const seasonsValue = settings.seasons_enabled
    ? settings.season_length === 'manual'
      ? isOwner
        ? 'When you end it'
        : 'When the owner ends it'
      : settings.season_length === 'custom'
        ? 'On a set date'
        : `Every ${formatSeasonLength((settings.season_length ?? '3m') as SeasonLength)}`
    : 'Off';

  return (
    <SettingsCard>
      <SettingRow
        label="Token allocation"
        consequence={
          isOwner
            ? 'What each member starts with. Never touches a current balance.'
            : 'What you started with. Everyone got the same.'
        }
        value={formatTokens(settings.seed_amount)}
      />
      <SettingRow
        label="Betting"
        consequence={bettingConsequence}
        value={<StatusPill tone={bettingValue === 'Open' ? 'dark' : 'muted'}>{bettingValue}</StatusPill>}
      />
      <SettingRow
        label="Endorsement"
        consequence={
          settings.require_endorsement
            ? isOwner
              ? 'A second member has to endorse a market before betting opens.'
              : 'Someone else has to endorse your market before betting opens.'
            : "Markets open for betting the moment they're created."
        }
        value={settings.require_endorsement ? 'Required' : 'Not needed'}
      />
      <SettingRow
        label="Hedging"
        consequence={
          settings.allow_hedged_bets
            ? `${you ? 'You' : 'Members'} can back more than one side of the same market.`
            : `${you ? 'You hold' : 'Members hold'} one side per market. Adding to that same side is still fine.`
        }
        value={settings.allow_hedged_bets ? 'Allowed' : 'One side only'}
      />
      <SettingRow
        label="When nobody calls it"
        consequence={
          settings.distribute_payout
            ? `The market's creator takes ${settings.creator_payout_pct}%, and the rest tops up the group's other open markets.`
            : you
              ? 'You get your stake back.'
              : 'Every stake goes back to whoever placed it.'
        }
        value={settings.distribute_payout ? 'Split' : 'Refunded'}
      />
      <SettingRow
        label="Challenge window"
        consequence={
          isOwner
            ? 'How long a called result can be disputed, and how long a vote runs.'
            : 'How long you have to dispute a called result.'
        }
        value={`${settings.resolution_window_hours} ${settings.resolution_window_hours === 1 ? 'hour' : 'hours'}`}
      />
      <SettingRow
        label="Seasons"
        consequence={
          settings.seasons_enabled
            ? 'Standings archive to Awards, then everyone is reseeded.'
            : 'The board never resets. One running total, forever.'
        }
        value={seasonsValue}
      />
      <SettingRow
        label="Time zone"
        consequence="Shown beside every betting-closes time."
        value={friendlyTimezoneName(settings.timezone).replace(/ time$/, '')}
      />
    </SettingsCard>
  );
}
