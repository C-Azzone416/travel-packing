// Builds the DataContext the UI's server actions use: the real database, the auth runtime, and the real clock.
// Returns null when the database is not configured, so callers can show a truthful error instead of crashing.

import { getAuth } from "../auth/auth-runtime";
import { createAppDb } from "../db/neon";
import type { Db } from "../db/retention";
import type { DataContext } from "./context";

let cachedDb: Db | undefined;

export async function getDataContext(
  env: Record<string, string | undefined> = process.env,
): Promise<DataContext | null> {
  const connectionString = env.DATABASE_URL?.trim();
  if (!connectionString) return null;
  cachedDb ??= createAppDb(connectionString);
  const auth = await getAuth(env);
  return { db: cachedDb, auth, now: () => new Date() };
}

/** Test hook: forget the cached connection. */
export function resetDataRuntime(): void {
  cachedDb = undefined;
}
