/**
 * Pure helpers for Manage group / live rules. Client components import this file, so it
 * must never touch next/headers — the cookies() loader lives in groupManageLoad.ts.
 */
import { formatTokens } from '@/lib/formatNumber';
import type { GroupSettings } from '@/lib/actions/groups';
import type { SeasonLength } from '@/lib/seasonLength';

export interface ActiveSeasonSummary {
  number: number;
  name: string | null;
  bettingOpen: boolean;
}

export interface RosterRow {
  id: string;
  user_id: string;
  status: string;
  nickname: string | null;
  role: string | null;
}

export interface GroupManageContext {
  groupId: string;
  group: {
    id: string;
    name: string;
    avatar_key: string | null;
    invite_code: string;
    owner_id: string;
    deletion_scheduled_at: string | null;
    is_public: boolean;
  };
  userId: string;
  isOwner: boolean;
  isPublic: boolean;
  isModerator: boolean;
  canBan: boolean;
  canEditSettings: boolean;
  settings: GroupSettings | null;
  season: ActiveSeasonSummary | null;
  activeSeasonRow: { id: string; number: number; name: string | null } | null;
  roster: RosterRow[];
  myMembership: { nickname: string; role: string | null } | null;
  roleLabel: 'Owner' | 'Moderator' | null;
}

/** "Season 2, Fall Run" — or just "Season 2" while it's unnamed. */
export function seasonLabel(season: ActiveSeasonSummary): string {
  return season.name ? `Season ${season.number}, ${season.name}` : `Season ${season.number}`;
}

export function formatChallengeWindow(hours: number, style: 'long' | 'short' = 'long'): string {
  if (hours === 0.5) return style === 'short' ? '30m' : '30 min';
  if (hours === 1) return style === 'short' ? '1h' : '1 hour';
  return style === 'short' ? `${hours}h` : `${hours} hours`;
}

export function bettingStatus(
  settings: GroupSettings,
  season: ActiveSeasonSummary | null
): { value: string; consequence: string; memberValue: string } {
  if (settings.seasons_enabled) {
    if (!season) {
      return {
        value: 'Between seasons',
        consequence: 'No one can start a market until the next season begins',
        memberValue: 'Between seasons',
      };
    }
    if (season.bettingOpen) {
      return { value: 'Open', consequence: 'Anyone can start a market', memberValue: 'On' };
    }
    return {
      value: 'Not open yet',
      consequence: 'No one can start a market yet',
      memberValue: 'Off',
    };
  }
  if (settings.betting_enabled) {
    return { value: 'Open', consequence: 'Anyone can start a market', memberValue: 'On' };
  }
  return { value: 'Not open yet', consequence: 'No one can start a market', memberValue: 'Off' };
}

export function groupSettingsSubtitle(
  settings: GroupSettings,
  season: ActiveSeasonSummary | null,
  isPublic: boolean
): string {
  if (isPublic) return `${formatTokens(settings.seed_amount)} to start`;
  const betting = bettingStatus(settings, season);
  const bettingBit =
    betting.value === 'Open' ? 'betting open' : betting.value === 'Between seasons' ? 'between seasons' : 'betting not open';
  return `${formatTokens(settings.seed_amount)} to start · ${bettingBit} · ${formatChallengeWindow(settings.resolution_window_hours, 'short')} challenge window`;
}

export function membersSubtitle(roster: RosterRow[]): string {
  const dormant = roster.filter((m) => m.status === 'dormant').length;
  const active = roster.length - dormant;
  return dormant > 0 ? `${active} in, ${dormant} dormant` : `${active} in`;
}

export function stakesSubtitle(prizeText: string | null, punishmentText: string | null): string {
  const parts: string[] = [];
  if (prizeText) parts.push(`🏆 ${prizeText}`);
  if (punishmentText) parts.push(`💀 ${punishmentText}`);
  return parts.join(' · ') || 'None set';
}

export function inviteFooter(settings: GroupSettings): string {
  const accepting = settings.accepting_members ? 'Accepting new members' : 'Joining paused';
  const join = settings.join_message ? 'join message set' : 'no join message';
  return `${accepting} · ${join}`;
}

/** The settings front door: owners manage the group, everyone else is looking at how it's set up. */
export function groupSetupTitle(isOwner: boolean): string {
  return isOwner ? 'Manage group' : 'Group setup';
}

/**
 * `update_group_settings` is a full-object RPC, not a patch. Every live-save call site
 * starts from the stored row and overlays only the fields that screen actually edits,
 * matching the public-group coercions LiveRulesForm still applies before each write.
 */
export function groupSettingsInput(
  settings: GroupSettings,
  isPublic: boolean,
  patch: {
    seedAmount?: number;
    seasonsEnabled?: boolean;
    seasonLength?: SeasonLength | null;
    seasonCustomEndsAt?: string | null;
    timezone?: string;
    bettingEnabled?: boolean;
    acceptingMembers?: boolean;
    distributePayout?: boolean;
    creatorPayoutPct?: number;
    allowHedgedBets?: boolean;
    resolutionWindowHours?: number;
    requireEndorsement?: boolean;
    joinMessage?: string | null;
    awardsEnabled?: boolean;
    prizeText?: string | null;
    punishmentText?: string | null;
  } = {}
) {
  const seasonsEnabled = isPublic ? false : (patch.seasonsEnabled ?? settings.seasons_enabled);
  const seasonLength = isPublic || !seasonsEnabled ? null : (patch.seasonLength !== undefined ? patch.seasonLength : settings.season_length);
  const seasonCustomEndsAt =
    !isPublic && seasonsEnabled && seasonLength === 'custom'
      ? (patch.seasonCustomEndsAt !== undefined ? patch.seasonCustomEndsAt : settings.season_custom_ends_at)
      : null;

  return {
    seedAmount: patch.seedAmount ?? settings.seed_amount,
    seasonsEnabled,
    seasonLength,
    seasonCustomEndsAt,
    timezone: patch.timezone ?? settings.timezone,
    bettingEnabled: isPublic ? true : (patch.bettingEnabled ?? settings.betting_enabled),
    acceptingMembers: isPublic ? true : (patch.acceptingMembers ?? settings.accepting_members),
    distributePayout: isPublic ? true : (patch.distributePayout ?? settings.distribute_payout),
    creatorPayoutPct: isPublic ? 0 : (patch.creatorPayoutPct ?? settings.creator_payout_pct),
    allowHedgedBets: isPublic ? false : (patch.allowHedgedBets ?? settings.allow_hedged_bets),
    resolutionWindowHours: patch.resolutionWindowHours ?? settings.resolution_window_hours,
    requireEndorsement: isPublic ? false : (patch.requireEndorsement ?? settings.require_endorsement),
    joinMessage: isPublic ? null : (patch.joinMessage !== undefined ? patch.joinMessage : settings.join_message),
    awardsEnabled: isPublic ? false : (patch.awardsEnabled ?? settings.awards_enabled),
    prizeText: isPublic ? null : (patch.prizeText !== undefined ? patch.prizeText : settings.prize_text),
    punishmentText: isPublic ? null : (patch.punishmentText !== undefined ? patch.punishmentText : settings.punishment_text),
  };
}
