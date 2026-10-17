import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { artworkFor, DESTINATION_ART, FALLBACK_ART } from "./destination-art";

const root = process.cwd();
const publicFile = (src: string) => join(root, "public", src);

describe("artworkFor", () => {
  it.each([
    ["us-ca-san-diego", "san-diego", "/destinations/destination-san-diego.jpg"],
    ["pt-lisbon", "lisbon", "/destinations/destination-lisbon.jpg"],
    ["gb-eng-london", "london", "/destinations/destination-london.jpg"],
  ])("maps %s to its own illustration", (id, key, src) => {
    expect(artworkFor(id)).toEqual({ key, src });
  });

  it.each([
    ["an unknown ID", "us-ca-palm-springs"],
    ["the other London entry", "ca-on-london"],
    ["a custom typed destination", "custom"],
    ["an empty string", ""],
    ["null", null],
    ["undefined", undefined],
    ["an inherited property name", "constructor"],
    ["another inherited property name", "__proto__"],
  ])("uses the landmark-neutral fallback for %s", (_label, id) => {
    expect(artworkFor(id)).toBe(FALLBACK_ART);
    expect(FALLBACK_ART.key).toBe("fallback");
  });
});

describe("artwork data", () => {
  const everyEntry = [...Object.entries(DESTINATION_ART), ["(fallback)", FALLBACK_ART] as const];

  it("is data only: no label or caption that could reach the UI, and no 'sample' wording", () => {
    for (const [id, art] of everyEntry) {
      expect(Object.keys(art).sort(), id).toEqual(["key", "src"]);
      expect(`${id} ${art.key} ${art.src}`.toLowerCase(), id).not.toContain("sample");
    }
  });

  it("uses a unique key per entry", () => {
    const keys = everyEntry.map(([, art]) => art.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("points at images that exist and are local (no external photo or geocoding calls)", () => {
    for (const [id, art] of everyEntry) {
      expect(art.src.startsWith("/destinations/"), id).toBe(true);
      expect(existsSync(publicFile(art.src)), id).toBe(true);
      expect(statSync(publicFile(art.src)).size, id).toBeGreaterThan(10_000);
    }
  });

  it("ships the four approved prototype images unmodified", () => {
    for (const [id, art] of everyEntry) {
      const file = art.src.replace("/destinations/", "");
      const original = readFileSync(join(root, "reference/prototype/dist/assets", file));
      expect(readFileSync(publicFile(art.src)).equals(original), id).toBe(true);
    }
  });

  it("logs every asset in docs/ART_SOURCES.md with its destination ID (#32)", () => {
    const log = readFileSync(join(root, "docs/ART_SOURCES.md"), "utf8");
    for (const [id, art] of Object.entries(DESTINATION_ART)) {
      const row = log
        .split("\n")
        .find((line) => line.includes(art.src.replace("/destinations/", "")));
      expect(row, id).toBeDefined();
      expect(row, id).toContain(`\`${id}\``);
      expect(row, id).toContain("Original, no third-party content");
    }
    const fallbackRow = log
      .split("\n")
      .find((line) => line.includes(FALLBACK_ART.src.replace("/destinations/", "")));
    expect(fallbackRow).toContain("Original, no third-party content");
  });
});
