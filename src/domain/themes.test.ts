import { describe, expect, it } from "vitest";
import { DEFAULT_THEME, isThemeId, THEME_IDS, THEMES, themeFor } from "./themes";

describe("themes", () => {
  it("offers exactly the six built-in themes, Travel first, each with a visible label and its own image", () => {
    expect(THEME_IDS).toEqual(["travel", "city", "beach", "outdoors", "theme_park", "home"]);
    expect(THEMES.map((theme) => theme.id)).toEqual([...THEME_IDS]);
    expect(THEMES.map((theme) => theme.label)).toEqual([
      "Travel",
      "City",
      "Beach",
      "Mountain / outdoors",
      "Theme park",
      "Home / family",
    ]);
    expect(new Set(THEMES.map((theme) => theme.src)).size).toBe(6);
    for (const theme of THEMES) expect(theme.src).toBe(`/themes/${theme.id}.svg`);
  });

  it("defaults to Travel", () => {
    expect(DEFAULT_THEME).toBe("travel");
  });

  it("recognizes only the six ids", () => {
    for (const id of THEME_IDS) expect(isThemeId(id)).toBe(true);
    for (const value of ["", "Travel", "park", "constructor", "__proto__", null, undefined, 3])
      expect(isThemeId(value)).toBe(false);
  });

  it("falls back to Travel for a missing or unknown theme", () => {
    expect(themeFor("beach").id).toBe("beach");
    for (const value of [undefined, null, "", "nope", "constructor"])
      expect(themeFor(value).id).toBe("travel");
  });
});
