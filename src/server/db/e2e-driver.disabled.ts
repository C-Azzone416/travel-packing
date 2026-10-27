// What `@/server/db/e2e-driver` resolves to in every build made WITHOUT NEXT_PUBLIC_E2E_BUILD=1 (see next.config.ts).
// Same exports, but it can never enable anything, so the real e2e database driver (and the `pg` client it imports)
// is not part of any deployed bundle.

import type { Db } from "./retention";

export const E2E_DB_DRIVER_MARKER = "";

export function e2eDatabaseEnabled(): boolean {
  return false;
}

export function createE2eDb(): Db {
  throw new Error("The e2e database driver is not compiled into this build");
}

export function createSharedE2eDb(): Db {
  throw new Error("The e2e database driver is not compiled into this build");
}

export async function closeE2eDb(): Promise<void> {}
