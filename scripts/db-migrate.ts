// Applies every migration to an empty, in-memory Postgres (PGlite), rolls them all back, and applies them again.
// This is the CI/local proof that migrations apply and roll back cleanly. It never connects to a real database
// and reads no connection string.

import { PGlite } from "@electric-sql/pglite";
import { join } from "node:path";
import { loadMigrations, migrateDown, migrateUp } from "../src/server/db/migrator";

async function main(): Promise<void> {
  const db = new PGlite();
  const migrations = loadMigrations(join(process.cwd(), "drizzle"));
  console.log(`up:   ${(await migrateUp(db, migrations)).join(", ")}`);
  console.log(`down: ${(await migrateDown(db, migrations)).join(", ")}`);
  console.log(`up:   ${(await migrateUp(db, migrations)).join(", ")}`);
  await db.close();
  console.log("migrations apply and roll back cleanly");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
