import { describe, expect, it, vi } from "vitest";
import { DEFAULT_OWNER_ID } from "./cli";
import { isPlausibleOwnerId, runPreviewSeed, type PreviewSeedDeps } from "./preview";

const OWNER = "kA3x9Qe2LmN7pZ4tVb8RyUc1WdHf5GsJ"; // shape only; not a real id
const PREVIEW_DB = "postgres://user:pw@ep-preview-1.us-west-2.aws.neon.tech/neondb";
const base = {
  TARGET: "preview",
  PRODUCTION_DB_HOST: "ep-prod-9.us-east-2.aws.neon.tech",
  SEED_DATABASE_URL: PREVIEW_DB,
  SEED_ALLOWED_HOSTS: "ep-preview-1.us-west-2.aws.neon.tech",
};

function harness(code = 0) {
  const logs: string[] = [];
  const summary: string[] = [];
  const seed = vi.fn(async () => code);
  const deps: PreviewSeedDeps = { seed, log: (l) => logs.push(l), summary: (l) => summary.push(l) };
  return { deps, logs, summary, seed };
}

describe("runPreviewSeed: first-preview bootstrap (no owner id yet)", () => {
  it.each([[undefined], [""], ["   "]])(
    "skips the seed visibly and succeeds when PREVIEW_SEED_OWNER_ID is %j",
    async (owner) => {
      const { deps, logs, summary, seed } = harness();
      expect(await runPreviewSeed({ ...base, SEED_OWNER_ID: owner }, deps)).toBe(0);
      expect(seed).not.toHaveBeenCalled();
      expect(logs).toHaveLength(1);
      expect(logs[0]).toMatch(/^preview seed SKIPPED: PREVIEW_SEED_OWNER_ID is not set/);
      expect(summary).toEqual(logs);
    },
  );

  it("needs no database settings at all to skip, and never touches the database", async () => {
    const { deps, seed } = harness();
    expect(await runPreviewSeed({ TARGET: "preview" }, deps)).toBe(0);
    expect(seed).not.toHaveBeenCalled();
  });

  it("never substitutes an identity: no fixture owner, no email", async () => {
    const { deps, logs, seed } = harness();
    await runPreviewSeed({ ...base, OWNER_EMAIL_ALLOWLIST: "owner@example.test" }, deps);
    expect(seed).not.toHaveBeenCalled();
    expect(logs.join(" ")).not.toContain(DEFAULT_OWNER_ID);
    expect(logs.join(" ")).not.toContain("example.test");
  });
});

describe("runPreviewSeed: real owner", () => {
  it("seeds exactly the configured owner, with the owner trimmed", async () => {
    const { deps, logs, seed } = harness();
    expect(await runPreviewSeed({ ...base, SEED_OWNER_ID: `  ${OWNER} ` }, deps)).toBe(0);
    expect(seed).toHaveBeenCalledTimes(1);
    const passed = (seed.mock.calls[0] as unknown as [Record<string, string>])[0];
    expect(passed.SEED_OWNER_ID).toBe(OWNER);
    expect(logs).toEqual([
      "preview seed done: synthetic data loaded for the configured preview owner",
    ]);
  });

  it("passes a failing seed's exit code through without claiming success", async () => {
    const { deps, logs } = harness(1);
    expect(await runPreviewSeed({ ...base, SEED_OWNER_ID: OWNER }, deps)).toBe(1);
    expect(logs).toEqual([]);
  });
});

describe("runPreviewSeed: invalid owner id", () => {
  it.each([
    ["the fixture id", DEFAULT_OWNER_ID],
    ["an email address", "someone@example.test"],
    ["a URL", "https://example.test/u/abcdefgh"],
    ["too short", "abc"],
    ["spaces inside", "abcd efgh ijkl"],
    ["a dot", "abcdefgh.ijkl"],
  ])("refuses %s, seeds nothing and never prints the value", async (_name, value) => {
    const { deps, logs, summary, seed } = harness();
    expect(await runPreviewSeed({ ...base, SEED_OWNER_ID: value }, deps)).toBe(1);
    expect(seed).not.toHaveBeenCalled();
    expect(logs).toEqual([
      "preview seed refused: PREVIEW_SEED_OWNER_ID is not a Better Auth user id (copy the id of the verified preview owner)",
    ]);
    expect(summary).toEqual(logs);
    expect(logs.join(" ")).not.toContain(value);
  });

  it.each([[OWNER], ["0d0a8a4c-6c93-4b6f-9a53-3f3f6d1b1e11"], ["user_12345678"]])(
    "accepts the id shape %j",
    (id) => expect(isPlausibleOwnerId(id)).toBe(true),
  );
});

describe("runPreviewSeed: host guards", () => {
  it("refuses when the seed target is the production host, even in other spellings", async () => {
    for (const url of [
      "postgres://u:p@ep-prod-9.us-east-2.aws.neon.tech/neondb",
      "postgres://u:p@EP-PROD-9-pooler.us-east-2.aws.neon.tech./neondb",
    ]) {
      const { deps, logs, seed } = harness();
      expect(
        await runPreviewSeed({ ...base, SEED_OWNER_ID: OWNER, SEED_DATABASE_URL: url }, deps),
      ).toBe(1);
      expect(seed).not.toHaveBeenCalled();
      expect(logs).toEqual([
        "preview seed refused: the seed target is the production database host",
      ]);
    }
  });

  it.each([
    ["no PRODUCTION_DB_HOST", { PRODUCTION_DB_HOST: undefined }, /PRODUCTION_DB_HOST is not set/],
    ["no SEED_DATABASE_URL", { SEED_DATABASE_URL: undefined }, /SEED_DATABASE_URL is not set/],
    ["an unreadable SEED_DATABASE_URL", { SEED_DATABASE_URL: "not a url" }, /not a connection URL/],
  ])("fails closed with %s", async (_name, patch, message) => {
    const { deps, logs, seed } = harness();
    expect(await runPreviewSeed({ ...base, SEED_OWNER_ID: OWNER, ...patch }, deps)).toBe(1);
    expect(seed).not.toHaveBeenCalled();
    expect(logs[0]).toMatch(message);
  });

  it("never prints a connection string or host", async () => {
    const { deps, logs } = harness();
    await runPreviewSeed(
      {
        ...base,
        SEED_OWNER_ID: OWNER,
        SEED_DATABASE_URL: "postgres://u:pw@ep-prod-9.us-east-2.aws.neon.tech/neondb",
      },
      deps,
    );
    expect(logs.join(" ")).not.toMatch(/postgres|neon\.tech|pw/);
  });
});

describe("runPreviewSeed: production refusal", () => {
  it.each([
    ["production", "production"],
    ["unset", undefined],
    ["empty", ""],
    ["wrong case", "Preview"],
  ])("has no seed path when TARGET is %s, whatever else is set", async (_name, target) => {
    const { deps, logs, seed } = harness();
    expect(await runPreviewSeed({ ...base, TARGET: target, SEED_OWNER_ID: OWNER }, deps)).toBe(1);
    expect(seed).not.toHaveBeenCalled();
    expect(logs).toEqual([
      "preview seed refused: this is not a preview run (TARGET must be preview)",
    ]);
  });

  it("refuses production even with no owner id (no quiet skip that looks like success)", async () => {
    const { deps, seed } = harness();
    expect(await runPreviewSeed({ ...base, TARGET: "production" }, deps)).toBe(1);
    expect(seed).not.toHaveBeenCalled();
  });
});
