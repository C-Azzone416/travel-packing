// Test-only Postgres driver for the Playwright e2e run. In e2e the app talks to a PGlite socket server
// (src/server/db/e2e-db-server.ts) over the normal Postgres wire protocol with `pg`, instead of the Neon driver.
//
// This module is compiled out of every build made without NEXT_PUBLIC_E2E_BUILD=1 (next.config.ts aliases it to
// e2e-driver.disabled.ts) and refused on Vercel; CI greps the production builds for the marker below.

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import type { Db } from "./retention";
import * as schema from "./schema";

/** Present in the build output only if this module is bundled; scripts/check-no-e2e-in-build.ts looks for it. */
export const E2E_DB_DRIVER_MARKER = "e2e-test-only-pg-driver";

type Env = Record<string, string | undefined>;

/** Needs both exact e2e build opt-in and an explicit URL, and is never on Vercel (production or preview). */
export function e2eDatabaseEnabled(env: Env): boolean {
  return env.NEXT_PUBLIC_E2E_BUILD === "1" && Boolean(env.E2E_DATABASE_URL?.trim()) && !env.VERCEL;
}

/**
 * One connection, on purpose. PGlite is a single Postgres backend; its socket multiplexer cannot keep one
 * connection's open transaction apart from another connection's queries, so concurrent connections interleave and
 * break transactions. With a pool of one, a transaction holds the only connection and every other request queues
 * behind it. (Data-layer code uses the transaction handle inside transactions, so it never waits on itself.)
 */
export function createE2eDb(connectionString: string): Db {
  return drizzle(new Pool({ connectionString, max: 1, application_name: E2E_DB_DRIVER_MARKER }), {
    schema,
  }) as unknown as Db;
}

type E2eDbGlobal = typeof globalThis & {
  __packedSmartE2eDatabases?: Map<string, Db>;
};

/**
 * Next compiles route handlers, middleware and server components into separate bundles. A module-local app-db cache would
 * therefore create one pool per bundle and eventually exhaust PGlite's deliberately small socket limit. Keep the browser
 * test's single-connection pool process-wide instead: this both matches the driver's transaction-serialization contract and
 * prevents adding a route from making unrelated tests lose authentication. This module is absent from deployed builds.
 */
export function createSharedE2eDb(connectionString: string): Db {
  const root = globalThis as E2eDbGlobal;
  const databases = (root.__packedSmartE2eDatabases ??= new Map());
  const existing = databases.get(connectionString);
  if (existing) return existing;
  const db = createE2eDb(connectionString);
  databases.set(connectionString, db);
  return db;
}

/** Close the connection pool behind a database made by createE2eDb (tests and the e2e server shutdown). */
export async function closeE2eDb(db: Db): Promise<void> {
  const databases = (globalThis as E2eDbGlobal).__packedSmartE2eDatabases;
  if (databases) {
    for (const [connectionString, shared] of databases) {
      if (shared === db) databases.delete(connectionString);
    }
  }
  await (db as unknown as { $client: Pool }).$client.end();
}
