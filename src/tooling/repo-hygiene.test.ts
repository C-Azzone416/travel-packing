import { describe, expect, it } from "vitest";
import { findHygieneProblems, MAX_FILE_BYTES } from "./repo-hygiene";

const file = (path: string, bytes = 100) => ({ path, bytes });

describe("findHygieneProblems", () => {
  it("passes ordinary source, docs, images, and the env template", () => {
    expect(
      findHygieneProblems([
        file("src/app/page.tsx"),
        file("docs/schema.md"),
        file("public/destinations/destination-lisbon.jpg", 324_358),
        file("package-lock.json", 460_778),
        file(".env.example"),
        file("tests/e2e/helpers/auth.ts"),
      ]),
    ).toEqual([]);
  });

  describe("local database directories", () => {
    it.each([
      ".data/seed-db/PG_VERSION",
      ".data/seed-db/postgresql.conf",
      ".data/anything.txt",
      "nested/.data/x",
      "somewhere/pg_wal/000000010000000000000001",
      "somewhere/PG_VERSION",
    ])("rejects %s", (path) => {
      expect(findHygieneProblems([file(path)])).not.toEqual([]);
    });

    it("explains why", () => {
      expect(findHygieneProblems([file(".data/seed-db/base/1")])[0]).toContain(
        "local database directory",
      );
    });

    it("does not flag look-alikes", () => {
      expect(
        findHygieneProblems([
          file("src/data/store.ts"),
          file("docs/data.md"),
          file("my.data/file"),
        ]),
      ).toEqual([]);
    });
  });

  it.each([
    ["node_modules/pkg/index.js", "installed dependencies"],
    [".next/server/chunk.js", "build output"],
    ["test-results/screenshots/a.png", "test output"],
    ["playwright-report/index.html", "test output"],
    ["coverage/lcov.info", "coverage output"],
  ])("rejects %s", (path, why) => {
    expect(findHygieneProblems([file(path)])[0]).toContain(why);
  });

  describe("env files", () => {
    it.each([".env", ".env.local", ".env.production", ".env.development.local", "apps/web/.env"])(
      "rejects %s",
      (path) => {
        expect(findHygieneProblems([file(path)])[0]).toContain("env file");
      },
    );

    it("allows only the names-only template", () => {
      expect(findHygieneProblems([file(".env.example"), file("apps/web/.env.example")])).toEqual(
        [],
      );
    });
  });

  describe("size limit", () => {
    it("accepts a file exactly at the limit and rejects one byte over", () => {
      expect(findHygieneProblems([file("a.bin", MAX_FILE_BYTES)])).toEqual([]);
      const problems = findHygieneProblems([file("a.bin", MAX_FILE_BYTES + 1)]);
      expect(problems).toHaveLength(1);
      expect(problems[0]).toContain("a.bin");
      expect(problems[0]).toContain("exceeds");
    });

    it("the limit is 1 MiB", () => {
      expect(MAX_FILE_BYTES).toBe(1_048_576);
    });
  });

  it("reports every problem for every file, not just the first", () => {
    const problems = findHygieneProblems([
      file(".data/seed-db/pg_wal/segment", 16 * 1024 * 1024),
      file(".env.local"),
      file("src/ok.ts"),
    ]);
    expect(problems.filter((line) => line.startsWith(".data/seed-db/pg_wal/segment"))).toHaveLength(
      3,
    );
    expect(problems.some((line) => line.startsWith(".env.local"))).toBe(true);
    expect(problems.some((line) => line.startsWith("src/ok.ts"))).toBe(false);
  });
});
