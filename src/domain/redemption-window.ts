/** How long a started Framebriar redemption can be retried with the same attempt id before a new attempt starts (#259). */
export const REDEMPTION_WINDOW_MS = 15 * 60 * 1000;

/** The same window in whole minutes, for the words the person reads ("up to 15 minutes"). */
export const REDEMPTION_WINDOW_MINUTES = REDEMPTION_WINDOW_MS / 60_000;
