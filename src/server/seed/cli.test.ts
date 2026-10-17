import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { loadMigrations, migrateUp } from "../db/migrator";
import { MIGRATIONS_DIR } from "../db/__fixtures__/db";
import type { Db } from "../db/retention";
import * as schema from "../db/schema";
import {
  DEFAULT_LOCAL_DIR,
  DEFAULT_OWNER_ID,
  openLocalDb,
  realDeps,
  runSeedCli,
  type SeedCliDeps,
} from "./cli";
import { sampleTripId } from "./sample-data";

// Only this file: the remote opener must build the app's pooled connection, but no test ever connects.
vi.mock("../db/neon", () => ({ createAppDb: (url: string) => ({ fakeDbFor: url }) }));

const scratch = mkdtempSync(join(tmpdir(), "seed-cli-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

/** One in-memory database shared by the fake openers, so the CLI really seeds something we can inspect. */
async function fakeDeps() {
  const client = new PGlite();
  await migrateUp(client, loadMigrations(MIGRATIONS_DIR));
  const db = drizzle(client, { schema }) as unknown as Db;
  const logs: string[] = [];
  const closed: string[] = [];
  const opened: string[] = [];
  const deps: SeedCliDeps = {
    openLocal: async (dir) => {
      opened.push(`local:${dir}`);
      return { db, close: async () => void closed.push("local") };
    },
    openRemote: async (url) => {
      opened.push(`remote:${url}`);
      return { db, close: async () => void closed.push("remote") };
    },
    log: (line) => logs.push(line),
  };
  const tripOwners = async () =>
    (await client.query<{ owner_id: string }>("SELECT DISTINCT owner_id FROM trips")).rows.map(
      (row) => row.owner_id,
    );
  return { client, deps, logs, closed, opened, tripOwners };
}

const REMOTE = "postgres://user:pw@ep-dev-branch-123.us-west-2.aws.neon.tech/devdb";

describe("runSeedCli: local", () => {
  it("seeds a local database by default and prints only a summary", async () => {
    const { client, deps, logs, closed, opened, tripOwners } = await fakeDeps();
    expect(await runSeedCli([], {}, deps)).toBe(0);
    expect(opened).toEqual([`local:${DEFAULT_LOCAL_DIR}`]);
    expect(await tripOwners()).toEqual([DEFAULT_OWNER_ID]);
    expect(logs).toEqual(["seeded synthetic data: 2 trips and 11 staples for one owner"]);
    expect(closed).toEqual(["local"]);
    await client.close();
  });

  it.each([
    [["--pglite", "/tmp/x"], "/tmp/x"],
    [["--pglite=/tmp/y"], "/tmp/y"],
    [["--pglite"], DEFAULT_LOCAL_DIR],
  ])("reads the local directory from %j", async (argv, dir) => {
    const { client, deps, opened } = await fakeDeps();
    await runSeedCli(argv, {}, deps);
    expect(opened).toEqual([`local:${dir}`]);
    await client.close();
  });

  it.each([
    [["--owner", "cli-owner"], {}, "cli-owner"],
    [["--owner=cli-owner"], {}, "cli-owner"],
    [[], { SEED_OWNER_ID: " env-owner " }, "env-owner"],
    [["--owner", "cli-owner"], { SEED_OWNER_ID: "env-owner" }, "cli-owner"],
    [["--owner"], {}, DEFAULT_OWNER_ID],
  ])("picks the owner from %j and env %j", async (argv, env, owner) => {
    const { client, deps, tripOwners } = await fakeDeps();
    await runSeedCli(argv, env, deps);
    expect(await tripOwners()).toEqual([owner]);
    await client.close();
  });

  it("ignores unknown arguments", async () => {
    const { client, deps } = await fakeDeps();
    expect(await runSeedCli(["--whatever", "x"], {}, deps)).toBe(0);
    await client.close();
  });
});

describe("runSeedCli: remote", () => {
  it("needs --yes before touching a remote database, and opens nothing without it", async () => {
    const { client, deps, logs, opened } = await fakeDeps();
    expect(await runSeedCli([], { SEED_DATABASE_URL: REMOTE }, deps)).toBe(1);
    expect(logs).toEqual(["db:seed refused: seeding a remote database needs --yes"]);
    expect(opened).toEqual([]);
    await client.close();
  });

  it("seeds a remote database named by SEED_DATABASE_URL when confirmed", async () => {
    const { client, deps, closed, opened, tripOwners } = await fakeDeps();
    expect(await runSeedCli(["--yes"], { SEED_DATABASE_URL: REMOTE }, deps)).toBe(0);
    expect(opened).toEqual([`remote:${REMOTE}`]);
    expect(closed).toEqual(["remote"]);
    expect(await tripOwners()).toEqual([DEFAULT_OWNER_ID]);
    await client.close();
  });

  it("never reads the app's DATABASE_URL as a target", async () => {
    const { client, deps, opened } = await fakeDeps();
    await runSeedCli(["--yes"], { DATABASE_URL: REMOTE }, deps);
    expect(opened).toEqual([`local:${DEFAULT_LOCAL_DIR}`]);
    await client.close();
  });
});

describe("runSeedCli: refuses production and unsafe targets", () => {
  it.each([
    ["NODE_ENV=production", { NODE_ENV: "production" }, ["--yes"]],
    ["a Vercel runtime", { VERCEL: "1", SEED_DATABASE_URL: REMOTE }, ["--yes"]],
    ["the app's own database", { DATABASE_URL: REMOTE, SEED_DATABASE_URL: REMOTE }, ["--yes"]],
    ["an invalid URL", { SEED_DATABASE_URL: "not a url" }, ["--yes"]],
  ])("%s: exit 1, nothing opened, nothing written", async (_name, env, argv) => {
    const { client, deps, logs, opened, tripOwners } = await fakeDeps();
    expect(await runSeedCli(argv, env, deps)).toBe(1);
    expect(opened).toEqual([]);
    expect(await tripOwners()).toEqual([]);
    expect(logs).toHaveLength(1);
    expect(logs[0].startsWith("db:seed refused: ")).toBe(true);
    await client.close();
  });
});

describe("runSeedCli: failures", () => {
  it("reports an unexpected failure without its text (it could contain a connection string) and still closes", async () => {
    const closed: string[] = [];
    const logs: string[] = [];
    const deps: SeedCliDeps = {
      openLocal: async () => ({
        db: {
          insert: () => {
            throw new Error(`connect failed for ${REMOTE}`);
          },
        } as unknown as Db,
        close: async () => void closed.push("local"),
      }),
      openRemote: async () => {
        throw new Error("unused");
      },
      log: (line) => logs.push(line),
    };
    expect(await runSeedCli([], {}, deps)).toBe(1);
    expect(logs).toEqual(["db:seed failed"]);
    expect(closed).toEqual(["local"]);
  });

  it("reports a failure to open the database the same way", async () => {
    const logs: string[] = [];
    const deps: SeedCliDeps = {
      openLocal: async () => {
        throw new Error(`cannot open ${scratch}`);
      },
      openRemote: async () => {
        throw new Error("unused");
      },
      log: (line) => logs.push(line),
    };
    expect(await runSeedCli([], {}, deps)).toBe(1);
    expect(logs).toEqual(["db:seed failed"]);
  });
});

describe("openLocalDb (real on-disk PGlite)", () => {
  it("creates missing parent directories, migrates, and seeds; a second run changes nothing", async () => {
    const dir = join(scratch, "nested", "seed-db");
    const logs: string[] = [];
    const deps: SeedCliDeps = { ...realDeps, log: (line) => logs.push(line) };
    expect(await runSeedCli(["--pglite", dir], {}, deps)).toBe(0);

    const opened = await openLocalDb(dir);
    const snapshot = async () =>
      JSON.stringify(
        (await opened.db.select().from(schema.trips))
          .map((row) => ({ id: row.id, destination: row.destination }))
          .sort((a, b) => a.id.localeCompare(b.id)),
      );
    const first = await snapshot();
    expect(JSON.parse(first).map((row: { id: string }) => row.id)).toEqual(
      expect.arrayContaining([
        sampleTripId(DEFAULT_OWNER_ID, "san-diego"),
        sampleTripId(DEFAULT_OWNER_ID, "lisbon"),
      ]),
    );
    await opened.close();

    expect(await runSeedCli(["--pglite", dir], {}, deps)).toBe(0);
    const again = await openLocalDb(dir);
    expect(
      await (async () =>
        JSON.stringify(
          (await again.db.select().from(schema.trips))
            .map((row) => ({ id: row.id, destination: row.destination }))
            .sort((a, b) => a.id.localeCompare(b.id)),
        ))(),
    ).toBe(first);
    await again.close();
    expect(logs).toEqual([
      "seeded synthetic data: 2 trips and 11 staples for one owner",
      "seeded synthetic data: 2 trips and 11 staples for one owner",
    ]);
  });
});

describe("realDeps", () => {
  it("logs to the console", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    realDeps.log("hello");
    expect(log).toHaveBeenCalledWith("hello");
    log.mockRestore();
  });

  it("opens a remote database through the app's connection factory, and closing it is a no-op", async () => {
    const remote = await realDeps.openRemote(REMOTE);
    expect(remote.db).toEqual({ fakeDbFor: REMOTE });
    await expect(remote.close()).resolves.toBeUndefined();
  });

  it("opens local databases with openLocalDb", () => {
    expect(realDeps.openLocal).toBe(openLocalDb);
  });
});
