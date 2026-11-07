import { describe, expect, it } from "vitest";
import { DEFAULT_THEME, isThemeId, THEME_IDS } from "./themes";

describe("themes", () => {
  it("keeps accepting exactly the six historical stored values", () => {
    expect(THEME_IDS).toEqual(["travel", "city", "beach", "outdoors", "theme_park", "home"]);
  });

  it("defaults to Travel", () => {
    expect(DEFAULT_THEME).toBe("travel");
  });

  it("recognizes only the six ids", () => {
    for (const id of THEME_IDS) expect(isThemeId(id)).toBe(true);
    for (const value of ["", "Travel", "park", "constructor", "__proto__", null, undefined, 3])
      expect(isThemeId(value)).toBe(false);
  });
});
