import { describe, expect, it } from "vitest";
import {
  APPEARANCES,
  APPEARANCE_OPTIONS,
  LEGACY_APPEARANCES,
  appearanceCookieString,
  appearanceName,
  isAppearance,
  migrateAppearance,
  parseAppearance,
} from "./appearance";

describe("appearance", () => {
  it("offers exactly Ocean, Evergreen and Dusk, Ocean first (the default)", () => {
    expect([...APPEARANCES]).toEqual(["ocean", "evergreen", "dusk"]);
    for (const id of APPEARANCES) expect(parseAppearance(id)).toBe(id);
    expect(APPEARANCE_OPTIONS.map((option) => option.id)).toEqual([...APPEARANCES]);
  });

  it("treats missing, unknown and non-string values as Ocean", () => {
    const bad = [
      undefined,
      null,
      "",
      "Ocean",
      "dark",
      "ocean ",
      3,
      {},
      ["ocean"],
      "__proto__",
      "toString",
    ];
    for (const value of bad) {
      expect(parseAppearance(value)).toBe("ocean");
      expect(isAppearance(value)).toBe(false);
      expect(migrateAppearance(value)).toBeUndefined();
    }
  });

  it("maps the old ids: base and ocean to Ocean, terracotta to Evergreen, violet to Dusk", () => {
    expect(LEGACY_APPEARANCES).toEqual({
      base: "ocean",
      ocean: "ocean",
      terracotta: "evergreen",
      violet: "dusk",
    });
    expect(parseAppearance("base")).toBe("ocean");
    expect(parseAppearance("terracotta")).toBe("evergreen");
    expect(parseAppearance("violet")).toBe("dusk");
    expect(migrateAppearance("base")).toBe("ocean");
    expect(migrateAppearance("terracotta")).toBe("evergreen");
    expect(migrateAppearance("violet")).toBe("dusk");
    // An old id is not a current id: only migrateAppearance and parseAppearance accept it.
    expect(isAppearance("terracotta")).toBe(false);
  });

  it("names each scheme", () => {
    expect(APPEARANCES.map(appearanceName)).toEqual(["Ocean", "Evergreen", "Dusk"]);
  });

  it("builds a one-year Lax cookie, Secure only over https", () => {
    expect(appearanceCookieString("evergreen", false)).toBe(
      "appearance=evergreen; Path=/; Max-Age=31536000; SameSite=Lax",
    );
    expect(appearanceCookieString("dusk", true)).toMatch(/; Secure$/);
  });
});
