// `npm run db:seed`: loads the synthetic sample set into a database that is NEVER the app's own.
//
//   npm run db:seed                       local on-disk PGlite at .data/seed-db (migrated, then seeded)
//   npm run db:seed -- --pglite <dir>     local on-disk PGlite at <dir>
//   SEED_DATABASE_URL=... npm run db:seed -- --yes
//                                         a remote dev/preview database (already migrated); needs --yes
//   --owner <id>                          owner id to seed (default: SEED_OWNER_ID, else "seed-owner")
//
// Prints a summary only: never a connection string, never a trip date or place.

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { loadMigrations, migrateUp } from "../db/migrator";
import { createAppDb } from "../db/neon";
import type { Db } from "../db/retention";
import * as schema from "../db/schema";
import { assertSeedAllowed, SeedRefused } from "./guard";
import { seedSyntheticData } from "./seed";

type Env = Record<string, string | undefined>;

export interface OpenedDb {
  db: Db;
  close(): Promise<void>;
}

export interface SeedCliDeps {
  /** The run date (YYYY-MM-DD, UTC), from the injected clock: the sample trips' dates are relative to it. */
  today(): string;
  openLocal(dir: string): Promise<OpenedDb>;
  openRemote(url: string): Promise<OpenedDb>;
  log(line: string): void;
}

export const DEFAULT_LOCAL_DIR = ".data/seed-db";
export const DEFAULT_OWNER_ID = "seed-owner";

interface Options {
  localDir: string;
  owner: string;
  yes: boolean;
}

function parse(argv: string[], env: Env): Options {
  const options: Options = {
    localDir: DEFAULT_LOCAL_DIR,
    owner: env.SEED_OWNER_ID?.trim() || DEFAULT_OWNER_ID,
    yes: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--yes") options.yes = true;
    else if (arg === "--pglite") options.localDir = argv[++index] ?? DEFAULT_LOCAL_DIR;
    else if (arg.startsWith("--pglite=")) options.localDir = arg.slice("--pglite=".length);
    else if (arg === "--owner") options.owner = argv[++index] ?? options.owner;
    else if (arg.startsWith("--owner=")) options.owner = arg.slice("--owner=".length);
  }
  return options;
}

/** Returns the process exit code. */
export async function runSeedCli(argv: string[], env: Env, deps: SeedCliDeps): Promise<number> {
  const options = parse(argv, env);
  const remoteUrl = env.SEED_DATABASE_URL?.trim();
  let opened: OpenedDb | undefined;
  try {
    assertSeedAllowed(env, remoteUrl || undefined);
    if (remoteUrl && !options.yes) {
      throw new SeedRefused("seeding a remote database needs --yes");
    }
    opened = remoteUrl ? await deps.openRemote(remoteUrl) : await deps.openLocal(options.localDir);
    const summary = await seedSyntheticData(opened.db, options.owner, deps.today());
    deps.log(
      `seeded synthetic data: ${summary.trips} trips and ${summary.staples} staples for one owner`,
    );
    return 0;
  } catch (error) {
    // Refusals explain themselves; anything else is reported without its text (it could hold a connection string).
    deps.log(error instanceof SeedRefused ? error.message : "db:seed failed");
    return 1;
  } finally {
    await opened?.close();
  }
}

/** A local on-disk PGlite database with the migrations applied. */
export async function openLocalDb(dir: string): Promise<OpenedDb> {
  mkdirSync(dir, { recursive: true });
  const client = new PGlite(dir);
  await migrateUp(client, loadMigrations(join(process.cwd(), "drizzle")));
  return { db: drizzle(client, { schema }) as unknown as Db, close: () => client.close() };
}

export const realDeps: SeedCliDeps = {
  today: () => new Date().toISOString().slice(0, 10),
  openLocal: openLocalDb,
  openRemote: async (url) => ({ db: createAppDb(url), close: async () => {} }),
  log: (line) => console.log(line),
};
