import "server-only";

import { sql } from "drizzle-orm";
import type { Db } from "@/server/db/retention";

export type ProviderIdentityState = "present" | "absent" | "unavailable";

type QueryResult = { rows?: unknown } | readonly unknown[];

const resultRows = (result: QueryResult): readonly unknown[] => {
  if (Array.isArray(result)) return result;
  const rows = (result as { rows?: unknown }).rows;
  return Array.isArray(rows) ? rows : [];
};

/**
 * Read the Managed Neon Auth source-of-truth row for one exact identity incarnation. Neon documents `neon_auth.user` as
 * immediate, branch-local auth state. Any permission, connection, shape, or timestamp problem fails closed as unavailable.
 * No email or other user data is selected.
 */
export async function providerIdentityState(
  db: Pick<Db, "execute">,
  userId: string,
  identityCreatedAt: number,
): Promise<ProviderIdentityState> {
  if (!userId || !Number.isFinite(identityCreatedAt)) return "unavailable";
  try {
    const result = (await db.execute(sql`
      select exists (
        select 1
        from neon_auth."user"
        where id = ${userId}
          and "createdAt" = ${new Date(identityCreatedAt)}
      ) as "exists"
    `)) as QueryResult;
    const rows = resultRows(result);
    const value = (rows[0] as { exists?: unknown } | undefined)?.exists;
    return value === true ? "present" : value === false ? "absent" : "unavailable";
  } catch {
    return "unavailable";
  }
}
