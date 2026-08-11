/** Length caps on the free-text names people type, shared by the inputs that collect them and
    mirrored by the Postgres functions that store them (`create_group`/`rename_group`,
    `create_market`) — the input's `maxLength` is the polite stop, the function's check is the
    real one. Both count the trimmed string. */

/** Matches the season name cap, and what the group rename input allowed before the server enforced anything. */
export const GROUP_NAME_MAX_LENGTH = 60;

/** Deliberately generous: a title is a question, and the specifics of what counts as a win belong in
    the (uncapped) resolution criteria. Long enough that nobody writing a normal title meets it. */
export const MARKET_TITLE_MAX_LENGTH = 140;

/** The title box only starts showing its counter this close to the cap — a character count sitting
    under every title from the first keystroke reads as a limit to write up to, which is the opposite
    of what the form asks for. */
export const MARKET_TITLE_COUNTER_THRESHOLD = MARKET_TITLE_MAX_LENGTH - 30;
