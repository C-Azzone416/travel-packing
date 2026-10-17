import type { Allowlist } from "../auth/allowlist";
import type { AuthProvider } from "../auth/types";
import type { Db } from "../db/retention";

/** Everything an entry point needs: the database and the auth runtime. Owner identity comes only from auth. */
export interface DataContext {
  db: Db;
  auth: { provider: AuthProvider; allowlist: Allowlist };
}
