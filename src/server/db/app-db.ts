// The app's database connection, opened once per process and shared by everything that needs it (the data layer, and the
// sign-in gate in the auth runtime). Returns null when no database is configured, so callers can fail closed or show a
// truthful error instead of crashing.

import { createAppDb } from "./neon";
import type { Db } from "./retention";

type Env = Record<string, string | undefined>;

let cached: Db | undefined;

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

export async function getAppDb(env: Env = process.env): Promise<Db | null> {
  const connectionString = env.DATABASE_URL?.trim();
  cached ??=
    (await openE2eDb(env)) ?? (connectionString ? createAppDb(connectionString) : undefined);
  return cached ?? null;
}

/** Test hook: forget the cached connection. */
export function resetAppDb(): void {
  cached = undefined;
}
