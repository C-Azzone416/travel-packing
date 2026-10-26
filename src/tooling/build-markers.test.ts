import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { BUILD_MARKERS, CAPTURE_MARKERS, FRAMEBRIAR_MARKERS, markerHits } from "./build-markers";

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

describe("CAPTURE_MARKERS (the production build must not contain screenshot capture)", () => {
  it.each(CAPTURE_MARKERS.map((marker) => [marker.name, marker] as const))(
    "%s: its text is still in its source module and not in its stub",
    (_name, marker) => {
      expect(readFileSync(join(process.cwd(), marker.source), "utf8")).toContain(marker.text);
      const stub = readFileSync(
        join(process.cwd(), marker.source.replace(/\.ts$/, ".disabled.ts")),
        "utf8",
      );
      expect(stub).not.toContain(marker.text);
    },
  );

  it("are not also e2e markers, because Preview and e2e builds legitimately contain them", () => {
    const e2e = new Set(BUILD_MARKERS.map((marker) => marker.text));
    for (const marker of CAPTURE_MARKERS) expect(e2e.has(marker.text)).toBe(false);
  });
});

describe("FRAMEBRIAR_MARKERS (hosted builds must contain no local-only feedback code)", () => {
  it.each(FRAMEBRIAR_MARKERS.map((marker) => [marker.name, marker] as const))(
    "%s: its text is still in its source and not in the hosted stub",
    (_name, marker) => {
      expect(readFileSync(join(process.cwd(), marker.source), "utf8")).toContain(marker.text);
      expect(
        readFileSync(join(process.cwd(), "src/features/feedback/feedback.disabled.tsx"), "utf8"),
      ).not.toContain(marker.text);
    },
  );

  it("has distinct marker texts", () => {
    const texts = FRAMEBRIAR_MARKERS.map((marker) => marker.text);
    expect(new Set(texts).size).toBe(texts.length);
  });
});

describe("markerHits", () => {
  const scratch = mkdtempSync(join(tmpdir(), "marker-hits-"));
  afterAll(() => rmSync(scratch, { recursive: true, force: true }));

  it("finds a marker in a nested build file and names the file", () => {
    mkdirSync(join(scratch, "static", "chunks"), { recursive: true });
    writeFileSync(join(scratch, "static", "chunks", "a.js"), 'x="feedback-screenshot-capture"');
    writeFileSync(join(scratch, "static", "b.js"), "nothing here");
    expect(markerHits(scratch, CAPTURE_MARKERS)).toEqual([
      { name: "the screenshot capture module", path: join(scratch, "static", "chunks", "a.js") },
    ]);
  });

  it("reports nothing for a clean build", () => {
    const clean = join(scratch, "clean");
    mkdirSync(clean);
    writeFileSync(join(clean, "a.js"), "console.log(1)");
    expect(markerHits(clean, CAPTURE_MARKERS)).toEqual([]);
  });
});
