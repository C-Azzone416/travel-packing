// Ephemeral in-memory Postgres (PGlite) with the real migrations applied. Tests only: never a Neon connection.

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { join } from "node:path";
import { loadMigrations, migrateUp } from "../migrator";
import * as schema from "../schema";

export const MIGRATIONS_DIR = join(process.cwd(), "drizzle");

export async function createMigratedDb() {
  const client = new PGlite();
  await migrateUp(client, loadMigrations(MIGRATIONS_DIR));
  return { client, db: drizzle(client, { schema }) };
}

/** Remove every row (users cascade to everything). Keeps the schema and migration bookkeeping. */
export async function resetData(client: PGlite): Promise<void> {
  await client.exec('TRUNCATE TABLE "account_deletions", "users" CASCADE');
}
