// Production connections to Neon Postgres. Connection strings come from environment variable NAMES only
// (DATABASE_URL for the app, DATABASE_URL_UNPOOLED for migrations); nothing here has a default and nothing is
// ever logged. Tests never open a real connection (PGlite stands in; this module is tested with a mocked driver).

import { Client, Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import type { SqlExecutor } from "./migrator";
import type { Db } from "./retention";
import * as schema from "./schema";

/** The app's connection: pooled, transaction-capable (WebSocket) Neon driver wrapped in Drizzle. */
export function createAppDb(connectionString: string): Db {
  return drizzle(new Pool({ connectionString }), { schema }) as unknown as Db;
}

/** Neon pooled hostnames contain "-pooler". Migrations need a direct connection (DDL and session state). */
export function assertUnpooled(connectionString: string): void {
  let host: string;
  try {
    host = new URL(connectionString).hostname;
  } catch {
    throw new Error("DATABASE_URL_UNPOOLED is not a valid connection URL");
  }
  if (host.includes("-pooler")) {
    throw new Error("DATABASE_URL_UNPOOLED must be a direct (non-pooled) connection");
  }
}

export interface MigrationConnection extends SqlExecutor {
  close(): Promise<void>;
}

/** One direct connection for running migrations. Refuses a pooled URL. */
export function createMigrationConnection(connectionString: string): MigrationConnection {
  assertUnpooled(connectionString);
  const client = new Client({ connectionString });
  let connecting: Promise<void> | undefined;
  const ready = () => (connecting ??= client.connect());
  return {
    async exec(sql) {
      await ready();
      return client.query(sql);
    },
    async query<T = Record<string, unknown>>(sql: string, params?: unknown[]) {
      await ready();
      const result = await client.query(sql, params);
      return { rows: result.rows as T[] };
    },
    async close() {
      if (connecting) await client.end();
    },
  };
}
