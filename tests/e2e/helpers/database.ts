import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { SAMPLE_TODAY } from "../../../src/server/seed/sample-data";
import { seedSyntheticData } from "../../../src/server/seed/seed";
import type { Db } from "../../../src/server/db/retention";
import * as schema from "../../../src/server/db/schema";
import { E2E_DB_PORT } from "../support/ports";

export const E2E_DATABASE_URL = `postgres://postgres:postgres@127.0.0.1:${E2E_DB_PORT}/postgres`;

/**
 * Put one seeded owner back exactly as the e2e database started: every trip they have is deleted (the ones a test
 * created, and the ones it changed), then the sample set and default staples are loaded again. Called before each
 * test signs in, so no test depends on, or leaves behind, another test's data. Tests run one at a time.
 */
export async function resetOwnerData(ownerId: string): Promise<void> {
  const pool = new Pool({ connectionString: E2E_DATABASE_URL, max: 1 });
  try {
    const db = drizzle(pool, { schema }) as unknown as Db;
    await db.delete(schema.trips).where(eq(schema.trips.ownerId, ownerId));
    await seedSyntheticData(db, ownerId, SAMPLE_TODAY);
  } finally {
    await pool.end();
  }
}
