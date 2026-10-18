// Trip theme images (#48): each trip picks one of six built-in illustrations. The image is decorative (empty alt),
// and the theme's name is shown as text wherever it can be chosen. The default is Travel, used whenever nothing else
// fits.

export const THEME_IDS = ["travel", "city", "beach", "outdoors", "theme_park", "home"] as const;
export type ThemeId = (typeof THEME_IDS)[number];

export const DEFAULT_THEME: ThemeId = "travel";

export interface ThemeInfo {
  id: ThemeId;
  /** The visible name, in the order the picker shows them (Travel first so the default is easy to find). */
  label: string;
  /** Public URL of the original illustration (docs/ART_SOURCES.md has a row for each). */
  src: string;
}

export const THEMES: readonly ThemeInfo[] = [
  { id: "travel", label: "Travel", src: "/themes/travel.svg" },
  { id: "city", label: "City", src: "/themes/city.svg" },
  { id: "beach", label: "Beach", src: "/themes/beach.svg" },
  { id: "outdoors", label: "Mountain / outdoors", src: "/themes/outdoors.svg" },
  { id: "theme_park", label: "Theme park", src: "/themes/theme_park.svg" },
  { id: "home", label: "Home / family", src: "/themes/home.svg" },
];

export function isThemeId(value: unknown): value is ThemeId {
  return typeof value === "string" && (THEME_IDS as readonly string[]).includes(value);
}

/** The theme to show: anything missing or unknown falls back to Travel, never to an error. */
export function themeFor(id: unknown): ThemeInfo {
  return THEMES.find((theme) => theme.id === id) ?? THEMES[0];
}
