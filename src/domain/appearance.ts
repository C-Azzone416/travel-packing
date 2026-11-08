// The three Suitcase colour schemes (#380, Ocean / Evergreen / Dusk). Pure: no storage, no DOM. The saved value is one of
// these ids; anything else (a missing value, a stale cookie, a value from a newer build) means Ocean. The four older
// Field Ledger ids (#139) still arrive from old accounts and cookies and are mapped by LEGACY_APPEARANCES.

export const APPEARANCES = ["ocean", "evergreen", "dusk"] as const;
export type Appearance = (typeof APPEARANCES)[number];
export const DEFAULT_APPEARANCE: Appearance = "ocean";

/** Field Ledger ids that may still be stored in an account or a cookie, and the scheme each one becomes. */
export const LEGACY_APPEARANCES: Readonly<Record<string, Appearance>> = {
  base: "ocean",
  ocean: "ocean",
  terracotta: "evergreen",
  violet: "dusk",
};

/** The cookie that mirrors the owner setting so the server can set data-scheme before first paint. */
export const APPEARANCE_COOKIE = "appearance";
/** One year, in seconds. */
export const APPEARANCE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/**
 * The anonymous palette cookie (#283): what signed-out pages (sign-in, sign-up, verify, reset, ...) are themed with.
 * It holds ONLY a palette id, never an email, user or account id or session reference. It is httpOnly (only the server
 * reads it), SameSite=Lax, Secure in hosted builds, Path=/, and lives 1 year (Max-Age 31536000, Caroline's decision of
 * 2026-10-28). Sign-out keeps it; setting an account theme or signing in refreshes it from the account; permanent
 * account deletion clears it. It never influences authentication or authorization, and its value is never written
 * into an account.
 */
export const ANONYMOUS_APPEARANCE_COOKIE = "anon-appearance";
/** 1 year, in seconds (31536000). */
export const ANONYMOUS_APPEARANCE_COOKIE_MAX_AGE = 31536000;

export function isAppearance(value: unknown): value is Appearance {
  return typeof value === "string" && (APPEARANCES as readonly string[]).includes(value);
}

/**
 * A stored value (account column, mirror cookie or anonymous cookie) as a current scheme id: a current id as is, a
 * legacy Field Ledger id mapped through LEGACY_APPEARANCES, anything else undefined.
 */
export function migrateAppearance(value: unknown): Appearance | undefined {
  if (isAppearance(value)) return value;
  if (typeof value !== "string" || !Object.hasOwn(LEGACY_APPEARANCES, value)) return undefined;
  return LEGACY_APPEARANCES[value];
}

/** Any value that is neither a current nor a legacy id is Ocean. */
export function parseAppearance(value: unknown): Appearance {
  return migrateAppearance(value) ?? DEFAULT_APPEARANCE;
}

export interface AppearanceOption {
  id: Appearance;
  name: string;
  description: string;
}

export const APPEARANCE_OPTIONS: readonly AppearanceOption[] = [
  { id: "ocean", name: "Ocean", description: "Blue-grey and terracotta" },
  { id: "evergreen", name: "Evergreen", description: "Forest green and clay" },
  { id: "dusk", name: "Dusk", description: "Violet and coral" },
];

export function appearanceName(appearance: Appearance): string {
  return APPEARANCE_OPTIONS.find((option) => option.id === appearance)?.name ?? "Ocean";
}

/** The cookie string for document.cookie (the server sets the same cookie through Next's cookie API). */
export function appearanceCookieString(appearance: Appearance, secure: boolean): string {
  return `${APPEARANCE_COOKIE}=${appearance}; Path=/; Max-Age=${APPEARANCE_COOKIE_MAX_AGE}; SameSite=Lax${secure ? "; Secure" : ""}`;
}
