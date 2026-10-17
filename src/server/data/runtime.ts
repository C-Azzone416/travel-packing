// Builds the DataContext the UI's server actions use: the real database, the auth runtime, and the real clock.
// Returns null when the database is not configured, so callers can show a truthful error instead of crashing.

import { getAuth } from "../auth/auth-runtime";
import { createAppDb } from "../db/neon";
import type { Db } from "../db/retention";
import { selectResolver } from "../locations/resolver";
import type { DataContext } from "./context";

type Env = Record<string, string | undefined>;

let cachedDb: Db | undefined;

/**
 * The e2e database: a real Postgres over the wire (PGlite's socket server), used by Playwright only. Like the fake
 * sign-in it is compiled in only when the build sets NEXT_PUBLIC_E2E_BUILD=1 (next.config.ts aliases the import to
 * an inert stub otherwise) and it is refused on Vercel. The import must use the exact aliased specifier below.
 */
async function openE2eDb(env: Env): Promise<Db | null> {
  if (process.env.NEXT_PUBLIC_E2E_BUILD === "1") {
    const { createE2eDb, e2eDatabaseEnabled } = await import("@/server/db/e2e-driver");
    if (e2eDatabaseEnabled(env)) return createE2eDb(env.E2E_DATABASE_URL?.trim() ?? "");
  }
  return null;
}

export async function getDataContext(env: Env = process.env): Promise<DataContext | null> {
  const connectionString = env.DATABASE_URL?.trim();
  cachedDb ??=
    (await openE2eDb(env)) ?? (connectionString ? createAppDb(connectionString) : undefined);
  if (!cachedDb) return null;
  const auth = await getAuth(env);
  return { db: cachedDb, auth, now: () => new Date(), resolveLocation: selectResolver(env) };
}

/** Test hook: forget the cached connection. */
export function resetDataRuntime(): void {
  cachedDb = undefined;
}
