/** Caps on the free-text values people type, shared by the inputs that collect them and
    mirrored by the Postgres functions that store them (`create_group`/`rename_group`,
    `create_market`, `rename_season`, `update_group_settings`) — the input's `maxLength` (or
    clamp) is the polite stop, the function's check is the real one. Lengths count the trimmed
    string. */

/** Matches the season name cap, and what the group rename input allowed before the server enforced anything. */
export const GROUP_NAME_MAX_LENGTH = 60;

/** Same 60 as a group name. Blank is still allowed, and clears back to the "Season N" fallback. */
export const SEASON_NAME_MAX_LENGTH = 60;

/** Deliberately generous: a title is a question, and the specifics of what counts as a win belong in
    the (uncapped) resolution criteria. Long enough that nobody writing a normal title meets it. */
export const MARKET_TITLE_MAX_LENGTH = 140;

/** An option label has to survive rendering at large sizes with no wrapper of its own: the "On"
    value on the bet-confirmed ticket, the trailing bet pill on a market row, the "X leading" line.
    Those spots truncate long labels regardless, but a cap keeps the common case from ever needing
    to. 40 comfortably fits a real option ("Sad drunk sitting in corner") with room to spare. */
export const OPTION_LABEL_MAX_LENGTH = 40;

/** The title box only starts showing its counter this close to the cap — a character count sitting
    under every title from the first keystroke reads as a limit to write up to, which is the opposite
    of what the form asks for. */
export const MARKET_TITLE_COUNTER_THRESHOLD = MARKET_TITLE_MAX_LENGTH - 30;

/** Ceiling on `group_settings.seed_amount`, the per-member starting balance. Past this, every
    balance, bet, and payout in the group renders at a scale the cards and push bodies weren't
    built for. The floor is 1: the allocation input strips non-digits, so an emptied box submits 0,
    which would seed a group nobody can ever bet in. */
export const TOKEN_ALLOCATION_MAX = 1_000_000;
export const TOKEN_ALLOCATION_MIN = 1;

/** The owner's custom message shown to a new member right after they join. Short on purpose: it's a
    one-screen modal, not a place to paste in the group's whole set of house rules. */
export const JOIN_MESSAGE_MAX_LENGTH = 240;
