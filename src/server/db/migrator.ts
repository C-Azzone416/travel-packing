// Minimal versioned migration runner with up AND down, over drizzle-kit's file layout:
//   drizzle/meta/_journal.json   ordered list of migration tags (written by `drizzle-kit generate`)
//   drizzle/<tag>.sql            up   (statements separated by `--> statement-breakpoint`)
//   drizzle/down/<tag>.sql       down (hand-written, same separator)
//
// It talks to a tiny executor interface (PGlite satisfies it), so tests and CI run against an ephemeral
// Postgres and nothing here ever needs a real connection string.

import { readFileSync } from "node:fs";
import { join } from "node:path";

export interface SqlExecutor {
  exec(sql: string): Promise<unknown>;
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

export interface Migration {
  tag: string;
  up: string[];
  down: string[];
}

const STATEMENT_BREAKPOINT = "--> statement-breakpoint";
const MIGRATIONS_TABLE = "schema_migrations";

function statements(sql: string): string[] {
  return sql
    .split(STATEMENT_BREAKPOINT)
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
}

/** Read every migration listed in the journal, in order, with its down file. */
export function loadMigrations(dir: string): Migration[] {
  const journal = JSON.parse(readFileSync(join(dir, "meta", "_journal.json"), "utf8")) as {
    entries: { tag: string }[];
  };
  return journal.entries.map(({ tag }) => ({
    tag,
    up: statements(readFileSync(join(dir, `${tag}.sql`), "utf8")),
    down: statements(readFileSync(join(dir, "down", `${tag}.sql`), "utf8")),
  }));
}

async function ensureTable(db: SqlExecutor): Promise<void> {
  await db.exec(
    `CREATE TABLE IF NOT EXISTS "${MIGRATIONS_TABLE}" ("tag" text PRIMARY KEY, "applied_at" timestamptz NOT NULL DEFAULT now())`,
  );
}

/** Tags currently applied, oldest first. */
export async function appliedMigrations(db: SqlExecutor): Promise<string[]> {
  await ensureTable(db);
  const result = await db.query<{ tag: string }>(
    `SELECT "tag" FROM "${MIGRATIONS_TABLE}" ORDER BY "applied_at", "tag"`,
  );
  return result.rows.map((row) => row.tag);
}

/** Run one migration's statements and its bookkeeping row atomically. */
async function runInTransaction(db: SqlExecutor, work: () => Promise<void>): Promise<void> {
  await db.exec("BEGIN");
  try {
    await work();
    await db.exec("COMMIT");
  } catch (error) {
    await db.exec("ROLLBACK");
    throw error;
  }
}

/** Apply every pending migration in order. Returns the tags applied by this call. */
export async function migrateUp(db: SqlExecutor, migrations: Migration[]): Promise<string[]> {
  const done = new Set(await appliedMigrations(db));
  const applied: string[] = [];
  for (const migration of migrations.filter((candidate) => !done.has(candidate.tag))) {
    await runInTransaction(db, async () => {
      for (const statement of migration.up) await db.exec(statement);
      await db.query(`INSERT INTO "${MIGRATIONS_TABLE}" ("tag") VALUES ($1)`, [migration.tag]);
    });
    applied.push(migration.tag);
  }
  return applied;
}

/**
 * Roll back the most recent `steps` applied migrations (default: all), newest first.
 * Returns the tags rolled back. Destructive by design; callers must opt in explicitly.
 */
export async function migrateDown(
  db: SqlExecutor,
  migrations: Migration[],
  steps: number = Number.POSITIVE_INFINITY,
): Promise<string[]> {
  const done = new Set(await appliedMigrations(db));
  const pending = migrations
    .filter((candidate) => done.has(candidate.tag))
    .reverse()
    .slice(0, steps);
  const rolledBack: string[] = [];
  for (const migration of pending) {
    await runInTransaction(db, async () => {
      for (const statement of migration.down) await db.exec(statement);
      await db.query(`DELETE FROM "${MIGRATIONS_TABLE}" WHERE "tag" = $1`, [migration.tag]);
    });
    rolledBack.push(migration.tag);
  }
  return rolledBack;
}
