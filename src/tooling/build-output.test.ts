import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { buildOutputProblems, buildOutputSummary } from "./build-output";

const root = mkdtempSync(join(tmpdir(), "build-output-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
let counter = 0;

/** A fresh output directory with the given relative paths (a trailing "/" makes a directory). */
function output(paths: string[]): string {
  const dir = join(root, `out-${(counter += 1)}`);
  mkdirSync(dir, { recursive: true });
  for (const path of paths) {
    const full = join(dir, path);
    if (path.endsWith("/")) mkdirSync(full, { recursive: true });
    else {
      mkdirSync(join(full, ".."), { recursive: true });
      writeFileSync(full, "{}");
    }
  }
  return dir;
}

describe("buildOutputProblems", () => {
  it("accepts an output with a config and a server function", () => {
    expect(buildOutputProblems(output(["config.json", "functions/index.func/"]))).toEqual([]);
  });

  it("finds a function nested under route folders", () => {
    expect(
      buildOutputProblems(output(["config.json", "functions/api/locations/search.func/"])),
    ).toEqual([]);
  });

  it("refuses a directory that does not exist", () => {
    expect(buildOutputProblems(join(root, "nope"))).toEqual([
      "the build output directory does not exist",
    ]);
  });

  it("refuses an output with no functions directory (a static-only output)", () => {
    expect(buildOutputProblems(output(["config.json", "static/index.html"]))).toEqual([
      "the build output has no functions directory",
    ]);
  });

  it("refuses an empty functions directory", () => {
    expect(buildOutputProblems(output(["config.json", "functions/"]))).toEqual([
      "the build output has no server functions, so every route would 404",
    ]);
  });

  it("refuses functions that hold only files (no .func bundle)", () => {
    expect(
      buildOutputProblems(output(["config.json", "functions/index.prerender-config.json"])),
    ).toEqual(["the build output has no server functions, so every route would 404"]);
  });

  it("does not count a file named like a function bundle", () => {
    expect(buildOutputProblems(output(["config.json", "functions/fake.func"]))).toEqual([
      "the build output has no server functions, so every route would 404",
    ]);
  });

  it("does not search deeper than it should", () => {
    const deep = "functions/a/b/c/d/e/f/g/h/x.func/";
    expect(buildOutputProblems(output(["config.json", deep]))).toEqual([
      "the build output has no server functions, so every route would 404",
    ]);
  });

  it("reports a missing config.json as well", () => {
    expect(buildOutputProblems(output(["functions/index.func/"]))).toEqual([
      "the build output has no config.json",
    ]);
  });

  it("reports both problems for an empty directory, without printing any path", () => {
    const problems = buildOutputProblems(output([]));
    expect(problems).toEqual([
      "the build output has no config.json",
      "the build output has no functions directory",
    ]);
    expect(problems.join(" ")).not.toContain(root);
  });

  it("ignores a broken symlink inside functions", () => {
    const dir = output(["config.json", "functions/"]);
    symlinkSync(join(root, "missing-target"), join(dir, "functions", "dangling.func"));
    expect(buildOutputProblems(dir)).toEqual([
      "the build output has no server functions, so every route would 404",
    ]);
  });
});

describe("buildOutputSummary", () => {
  it("counts the function bundles, totals the size and names the framework in config.json", () => {
    const dir = output([
      "functions/a.func/index.js",
      "functions/api/b.func/index.js",
      "static/x.txt",
    ]);
    writeFileSync(
      join(dir, "config.json"),
      JSON.stringify({ framework: { slug: "nextjs", version: "16.4.2" } }),
    );
    writeFileSync(join(dir, "static", "big.bin"), Buffer.alloc(1024 * 1024));
    expect(buildOutputSummary(dir)).toEqual([
      "build output summary: 2 function bundles, 1.0 MB in total (symlinks followed)",
      "build output summary: config.json framework: nextjs 16.4.2",
    ]);
  });

  it("says so when config.json names no framework, has only a slug, or cannot be read", () => {
    const none = output(["functions/a.func/"]);
    writeFileSync(join(none, "config.json"), "{}");
    expect(buildOutputSummary(none)[1]).toBe(
      "build output summary: config.json framework: (none named)",
    );
    const slugOnly = output(["config.json"]);
    writeFileSync(join(slugOnly, "config.json"), JSON.stringify({ framework: { slug: "other" } }));
    expect(buildOutputSummary(slugOnly)[1]).toBe(
      "build output summary: config.json framework: other",
    );
    const bad = output(["functions/"]);
    writeFileSync(join(bad, "config.json"), "{ nope");
    expect(buildOutputSummary(bad)[1]).toBe(
      "build output summary: config.json framework: (config.json unreadable)",
    );
    expect(buildOutputSummary(output([]))[1]).toBe(
      "build output summary: config.json framework: (config.json unreadable)",
    );
  });

  it("reports an output of zero functions plainly, and a missing directory", () => {
    expect(buildOutputSummary(output(["config.json", "static/index.html"]))[0]).toBe(
      "build output summary: 0 function bundles, 0.0 MB in total (symlinks followed)",
    );
    expect(buildOutputSummary(join(root, "gone"))).toEqual([
      "build output summary: the directory does not exist",
    ]);
  });

  it("never prints a path or a file name", () => {
    const dir = output(["functions/secret-route-name.func/index.js", "config.json"]);
    expect(buildOutputSummary(dir).join(" ")).not.toMatch(/secret-route-name|out-/);
  });
});
