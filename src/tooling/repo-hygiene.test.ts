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

  describe("email address literals", () => {
    it("rejects mixed-case non-reserved addresses in any tracked text file without echoing it", () => {
      // Assemble the unreserved domain at run time so this regression fixture does not trip the
      // repository-wide check that it is testing.
      const address = ["Owner@Private", ".INTERNAL"].join("");
      const problems = findHygieneProblems([
        {
          ...file("src/auth.test.ts"),
          text: `const fixture = "safe@example.test"; const owner = "${address}";`,
        },
      ]);

      expect(problems).toEqual([
        "src/auth.test.ts: email address literals must use reserved example domains",
      ]);
      expect(problems.join("\n")).not.toContain(address);
    });

    it.each([
      "owner@example.com",
      "owner@example.org",
      "owner@example.net",
      "owner@sub.example.com",
      "owner@example.test",
      "owner@sub.example.invalid",
      "owner@localhost",
    ])("allows synthetic addresses on reserved domains: %s", (address) => {
      expect(
        findHygieneProblems([
          { ...file("src/auth.test.ts"), text: `const fixture = "${address}";` },
        ]),
      ).toEqual([]);
    });

    it("passes ordinary prose without an address", () => {
      expect(
        findHygieneProblems([
          { ...file("docs/deploy.md"), text: "Contact the owner for access." },
          { ...file("src/example.ts"), text: "export const fixture = true;" },
        ]),
      ).toEqual([]);
    });

    it("does not mistake URL credentials for an email address", () => {
      expect(
        findHygieneProblems([
          {
            ...file("src/db.test.ts"),
            text: "postgres://user:password@db.internal/app",
          },
        ]),
      ).toEqual([]);
    });

    it("fails closed when a tracked file cannot be inspected", () => {
      expect(
        findHygieneProblems([
          { ...file("src/unreadable.ts"), inspectionFailed: true },
          { ...file("public/image.png"), text: undefined },
        ]),
      ).toEqual(["src/unreadable.ts: tracked file could not be inspected"]);
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

    it("exempts only the root package-lock.json from the size limit", () => {
      const big = MAX_FILE_BYTES * 3;
      expect(findHygieneProblems([file("package-lock.json", big)])).toEqual([]);
      expect(findHygieneProblems([file("sub/package-lock.json", big)])).toHaveLength(1);
      expect(findHygieneProblems([file("package-lock.json.bak", big)])).toHaveLength(1);
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
