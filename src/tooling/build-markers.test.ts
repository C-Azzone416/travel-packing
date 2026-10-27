import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  BUILD_MARKERS,
  CAPTURE_MARKERS,
  FRAMEBRIAR_BROWSER_CREDENTIAL_MARKERS,
  FRAMEBRIAR_MARKERS,
  markerHits,
} from "./build-markers";

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

describe("FRAMEBRIAR_MARKERS (Preview contains feedback and Production does not)", () => {
  it.each(FRAMEBRIAR_MARKERS.map((marker) => [marker.name, marker] as const))(
    "%s: its text is still in its source and not in the Production stub",
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

describe("FRAMEBRIAR_BROWSER_CREDENTIAL_MARKERS (no browser credential path in any feedback build, #260)", () => {
  it.each(FRAMEBRIAR_BROWSER_CREDENTIAL_MARKERS.map((marker) => [marker.name, marker] as const))(
    "%s: its text is still in the SDK file, and nothing of ours contains it",
    (_name, marker) => {
      expect(readFileSync(join(process.cwd(), marker.source), "utf8")).toContain(marker.text);
      for (const ours of [
        "src/features/feedback/FeedbackAccess.tsx",
        "src/features/feedback/enrollment-client.ts",
        "src/features/feedback/delivery.ts",
        "src/features/feedback/account-scope.ts",
      ]) {
        expect(readFileSync(join(process.cwd(), ours), "utf8")).not.toContain(marker.text);
      }
    },
  );

  it("are not also markers that must be present", () => {
    const present = new Set(FRAMEBRIAR_MARKERS.map((marker) => marker.text));
    for (const marker of FRAMEBRIAR_BROWSER_CREDENTIAL_MARKERS)
      expect(present.has(marker.text)).toBe(false);
  });

  it("finds a browser credential module in a build directory", () => {
    const dir = mkdtempSync(join(tmpdir(), "credential-markers-"));
    try {
      writeFileSync(join(dir, "chunk.js"), 'throw new Error("Playtest access unavailable")');
      expect(markerHits(dir, FRAMEBRIAR_BROWSER_CREDENTIAL_MARKERS).map((hit) => hit.name)).toEqual(
        ["the SDK's browser access controller (redeems and refreshes a credential)"],
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
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

  it("ignores Next's non-deployable incremental cache", () => {
    const build = join(scratch, "build-with-cache");
    mkdirSync(join(build, "cache"), { recursive: true });
    writeFileSync(join(build, "cache", "compiler.pack"), "feedback-screenshot-capture");
    writeFileSync(join(build, "server.js"), "production output");
    expect(markerHits(build, CAPTURE_MARKERS)).toEqual([]);
  });
});
