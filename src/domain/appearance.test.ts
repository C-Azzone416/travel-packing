import { describe, expect, it } from "vitest";
import {
  APPEARANCES,
  APPEARANCE_OPTIONS,
  appearanceCookieString,
  appearanceName,
  isAppearance,
  parseAppearance,
} from "./appearance";

describe("appearance", () => {
  it("accepts exactly the four theme ids", () => {
    for (const id of APPEARANCES) expect(parseAppearance(id)).toBe(id);
    expect(APPEARANCE_OPTIONS.map((option) => option.id)).toEqual([...APPEARANCES]);
  });

  it("treats missing, unknown and non-string values as Base", () => {
    for (const bad of [undefined, null, "", "Ocean", "dark", "ocean ", 3, {}, ["ocean"]]) {
      expect(parseAppearance(bad)).toBe("base");
      expect(isAppearance(bad)).toBe(false);
    }
  });

  it("names each theme", () => {
    expect(APPEARANCES.map(appearanceName)).toEqual([
      "Base palette",
      "Deep Ocean",
      "Terracotta & Slate",
      "Ink Violet & Slate",
    ]);
  });

  it("builds a one-year Lax cookie, Secure only over https", () => {
    expect(appearanceCookieString("ocean", false)).toBe(
      "appearance=ocean; Path=/; Max-Age=31536000; SameSite=Lax",
    );
    expect(appearanceCookieString("violet", true)).toMatch(/; Secure$/);
  });
});
