// A real Postgres wire-protocol server for e2e, backed by PGlite: migrated and seeded with the synthetic sample set,
// in memory (so every run starts clean). Playwright starts it (scripts/e2e-db-server.ts) before the app; the app
// reaches it through e2e-driver.ts. Never used outside tests.

import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { drizzle } from "drizzle-orm/pglite";
import { join } from "node:path";
import { assertSeedAllowed } from "../seed/guard";
import { seedSyntheticData } from "../seed/seed";
import { loadMigrations, migrateUp } from "./migrator";
import type { Db } from "./retention";
import * as schema from "./schema";

export interface E2eDbServer {
  /** Connection string for the e2e driver. */
  url: string;
  port: number;
  stop(): Promise<void>;
}

export interface E2eDbOptions {
  /** 0 picks a free port. */
  port: number;
  /** Owners to seed with the synthetic sample set (ids as the e2e sign-in produces them). */
  seedOwners: string[];
  env?: Record<string, string | undefined>;
}

export async function startE2eDbServer({
  port,
  seedOwners,
  env = process.env,
}: E2eDbOptions): Promise<E2eDbServer> {
  // Same guard as `npm run db:seed`: this must never run in production or on Vercel.
  assertSeedAllowed(env);
  const client = await PGlite.create();
  await migrateUp(client, loadMigrations(join(process.cwd(), "drizzle")));
  const db = drizzle(client, { schema }) as unknown as Db;
  for (const owner of seedOwners) await seedSyntheticData(db, owner);

  const server = new PGLiteSocketServer({ db: client, port, host: "127.0.0.1", maxConnections: 8 });
  await server.start();
  const bound = Number(server.getServerConn().split(":").pop());
  return {
    port: bound,
    url: `postgres://postgres:postgres@127.0.0.1:${bound}/postgres`,
    async stop() {
      await server.stop();
      await client.close();
    },
  };
}
