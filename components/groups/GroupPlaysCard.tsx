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

/**
 * The eight rows that say how a group plays, identical for the owner and for a member — the
 * copy used to switch person ("members can..." vs "you can...") depending on who was looking,
 * which doubled the sentences to maintain for no real gain in clarity. Kept terse and universal
 * now; `isOwner` still branches the couple of rows where the actual meaning differs by role
 * (who ends a manual season, whose name appears as the setter elsewhere on the settings page).
 *
 * Nothing here is a control. Editing lives at /groups/[groupId]/settings/edit, which shows the same
 * list with the right-hand side swapped for inputs.
 */
export function GroupPlaysCard({
  settings,
  season,
  isOwner,
  isPublic = false,
}: {
  settings: GroupSettings;
  /** The currently active season, or null when there isn't one (seasons off, or between seasons). */
  season: ActiveSeasonSummary | null;
  isOwner: boolean;
  /** A public group's rules are almost entirely fixed (see ARCHITECTURE.md's "Public groups"
      section) — betting, endorsement, hedging, challenge window, seasons, and universal-loss
      pooling are none of them a preference there, so the whole read view drops to just token
      allocation and time zone rather than a wall of permanently-fixed rows. */
  isPublic?: boolean;
}) {
  // Betting: for a seasons-enabled group the season's own switch is the real gate, and
  // settings.betting_enabled stops mattering entirely once the first season starts.
  let bettingValue: string;
  let bettingConsequence: string;
  if (settings.seasons_enabled) {
    if (!season) {
      bettingValue = 'Between seasons';
      bettingConsequence = 'No one can start a market until the next season begins';
    } else if (season.bettingOpen) {
      bettingValue = 'Open';
      bettingConsequence = 'Anyone can start a market';
    } else {
      bettingValue = 'Not open yet';
      bettingConsequence = 'No one can start a market yet';
    }
  } else if (settings.betting_enabled) {
    bettingValue = 'Open';
    bettingConsequence = 'Anyone can start a market';
  } else {
    bettingValue = 'Not open yet';
    bettingConsequence = 'No one can start a market';
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
      <SettingRow label="Token allocation" consequence="What each new member starts with" value={formatTokens(settings.seed_amount)} />
      {!isPublic && (
        <SettingRow
          label="Betting"
          consequence={bettingConsequence}
          value={<StatusPill tone={bettingValue === 'Open' ? 'dark' : 'muted'}>{bettingValue}</StatusPill>}
        />
      )}
      {!isPublic && (
        <SettingRow
          label="Endorsement"
          consequence={settings.require_endorsement ? 'Markets need a second to open' : 'Markets open when created'}
          value={settings.require_endorsement ? 'Required' : 'Not needed'}
        />
      )}
      {!isPublic && (
        <SettingRow
          label="Hedging"
          consequence={
            settings.allow_hedged_bets
              ? 'Members can bet on more than one side of a market'
              : 'Members can only bet on one side of a market'
          }
          value={settings.allow_hedged_bets ? 'Allowed' : 'One side only'}
        />
      )}
      {!isPublic && (
        <SettingRow
          label="When nobody calls it"
          consequence={
            settings.distribute_payout
              ? `The market's creator takes ${settings.creator_payout_pct}% and the rest goes to open markets`
              : 'Bets get refunded'
          }
          value={settings.distribute_payout ? 'Split' : 'Refunded'}
        />
      )}
      {!isPublic && (
        <SettingRow
          label="Challenge window"
          consequence="How long a resolution can be challenged for, and how long the vote runs"
          value={`${settings.resolution_window_hours} ${settings.resolution_window_hours === 1 ? 'hour' : 'hours'}`}
        />
      )}
      {!isPublic && (
        <SettingRow
          label="Seasons"
          consequence={settings.seasons_enabled ? 'Standings archive, then everyone is reseeded' : 'The board never resets'}
          value={seasonsValue}
        />
      )}
      <SettingRow
        label="Time zone"
        consequence="Shown next to every closing time"
        value={friendlyTimezoneName(settings.timezone).replace(/ time$/, '')}
      />
    </SettingsCard>
  );
}
