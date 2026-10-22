import { describe, expect, it } from "vitest";
import { ALPHA3_BY_ALPHA2, alpha3For } from "./iso-alpha3";

describe("alpha3For", () => {
  it("covers the full ISO 3166-1 list with well-formed unique codes", () => {
    const entries = Object.entries(ALPHA3_BY_ALPHA2);
    expect(entries).toHaveLength(249);
    for (const [two, three] of entries) {
      expect(two).toMatch(/^[A-Z]{2}$/);
      expect(three).toMatch(/^[A-Z]{3}$/);
    }
    expect(new Set(entries.map(([, three]) => three)).size).toBe(249);
  });

  it("maps known codes, ignoring case and surrounding space", () => {
    expect(alpha3For("PT")).toBe("PRT");
    expect(alpha3For(" es ")).toBe("ESP");
    expect(alpha3For("jp")).toBe("JPN");
  });

  it("returns null for empty, missing and unknown codes, never inherited keys", () => {
    for (const bad of ["", "  ", "ZZ", "PRT", "P", null, undefined, "__proto__", "constructor"]) {
      expect(alpha3For(bad as string | null | undefined)).toBeNull();
    }
  });
});
