import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BUILD_MARKERS } from "./build-markers";

describe("BUILD_MARKERS", () => {
  it.each(BUILD_MARKERS.map((marker) => [marker.name, marker] as const))(
    "%s: its text is still in its source module",
    (_name, marker) => {
      const source = readFileSync(join(process.cwd(), marker.source), "utf8");
      expect(source).toContain(marker.text);
    },
  );

  it("has distinct marker texts", () => {
    const texts = BUILD_MARKERS.map((marker) => marker.text);
    expect(new Set(texts).size).toBe(texts.length);
  });
});
