// Builds the DataContext the UI's server actions use: the real database, the auth runtime, and the real clock.
// Returns null when the database is not configured, so callers can show a truthful error instead of crashing.

import { getAuth } from "../auth/auth-runtime";
import { getAppDb, resetAppDb } from "../db/app-db";
import { selectResolver } from "../locations/resolver";
import type { DataContext } from "./context";

type Env = Record<string, string | undefined>;

export async function getDataContext(env: Env = process.env): Promise<DataContext | null> {
  const db = await getAppDb(env);
  if (!db) return null;
  const auth = await getAuth(env);
  return { db, auth, now: () => new Date(), resolveLocation: selectResolver(env) };
}

/** Test hook: forget the cached connection. */
export function resetDataRuntime(): void {
  resetAppDb();
}
