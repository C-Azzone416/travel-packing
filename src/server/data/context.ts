import type { Allowlist } from "../auth/allowlist";
import type { AuthProvider } from "../auth/types";
import type { Db } from "../db/retention";

/** Everything an entry point needs: the database and the auth runtime. Owner identity comes only from auth. */
export interface DataContext {
  db: Db;
  auth: { provider: AuthProvider; allowlist: Allowlist };
  /** The clock, injected so no data-layer code reads time itself. The date/timezone policy is pending #26. */
  now: () => Date;
}

/** "Today" as YYYY-MM-DD (UTC) from the injected clock. */
export function todayOf(context: Pick<DataContext, "now">): string {
  return context.now().toISOString().slice(0, 10);
}
