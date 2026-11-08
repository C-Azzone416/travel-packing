// Legacy trip-theme values remain in stored trips and the database schema after the Suitcase redesign removed the
// illustrations and their picker. Keep accepting the six historical ids so old rows and copies continue to round-trip.

export const THEME_IDS = ["travel", "city", "beach", "outdoors", "theme_park", "home"] as const;
export type ThemeId = (typeof THEME_IDS)[number];

export const DEFAULT_THEME: ThemeId = "travel";

export function isThemeId(value: unknown): value is ThemeId {
  return typeof value === "string" && (THEME_IDS as readonly string[]).includes(value);
}
