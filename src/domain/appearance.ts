// The four Field Ledger colour themes (#139). Pure: no storage, no DOM. The saved value is one of these ids; anything
// else (a missing value, a stale cookie, a value from a newer build) means Base.

export const APPEARANCES = ["base", "ocean", "terracotta", "violet"] as const;
export type Appearance = (typeof APPEARANCES)[number];
export const DEFAULT_APPEARANCE: Appearance = "base";

/** The cookie that mirrors the owner setting so the server can set data-appearance before first paint. */
export const APPEARANCE_COOKIE = "appearance";
/** One year, in seconds. */
export const APPEARANCE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export function isAppearance(value: unknown): value is Appearance {
  return typeof value === "string" && (APPEARANCES as readonly string[]).includes(value);
}

/** Any value that is not one of the four ids is Base. */
export function parseAppearance(value: unknown): Appearance {
  return isAppearance(value) ? value : DEFAULT_APPEARANCE;
}

export interface AppearanceOption {
  id: Appearance;
  name: string;
  description: string;
}

export const APPEARANCE_OPTIONS: readonly AppearanceOption[] = [
  { id: "base", name: "Base palette", description: "Clay primary · ochre secondary" },
  { id: "ocean", name: "Deep Ocean", description: "Teal primary · copper secondary" },
  {
    id: "terracotta",
    name: "Terracotta & Slate",
    description: "Terracotta primary · slate secondary",
  },
  { id: "violet", name: "Ink Violet & Slate", description: "Violet primary · slate secondary" },
];

export function appearanceName(appearance: Appearance): string {
  return APPEARANCE_OPTIONS.find((option) => option.id === appearance)?.name ?? "Base palette";
}

/** The cookie string for document.cookie (the server sets the same cookie through Next's cookie API). */
export function appearanceCookieString(appearance: Appearance, secure: boolean): string {
  return `${APPEARANCE_COOKIE}=${appearance}; Path=/; Max-Age=${APPEARANCE_COOKIE_MAX_AGE}; SameSite=Lax${secure ? "; Secure" : ""}`;
}
