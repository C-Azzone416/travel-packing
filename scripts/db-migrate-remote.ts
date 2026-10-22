// Applies pending migrations to a real database over ONE direct (non-pooled) connection.
// Reads DATABASE_URL_UNPOOLED from the environment; it is never printed. Not run by CI, and not to be pointed at
// any shared or production database without Caroline's approval (security decisions #27-#29).

import { join } from "node:path";
import { loadMigrations, migrateUp } from "../src/server/db/migrator";
import { createMigrationConnection } from "../src/server/db/neon";

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL_UNPOOLED;
  if (!url) throw new Error("DATABASE_URL_UNPOOLED is not set");
  const connection = createMigrationConnection(url);
  try {
    const applied = await migrateUp(connection, loadMigrations(join(process.cwd(), "drizzle")));
    console.log(applied.length ? `applied: ${applied.join(", ")}` : "already up to date");
  } finally {
    await connection.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "migration failed");
  process.exit(1);
});
