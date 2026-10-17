import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { MIGRATIONS_DIR } from "./__fixtures__/db";
import {
  appliedMigrations,
  loadMigrations,
  migrateDown,
  migrateUp,
  type Migration,
} from "./migrator";

const EXPECTED_TAGS = ["0000_init", "0001_progress_clamp_trigger"];

// One in-memory Postgres for the file; each test starts from an empty public schema.
const client = new PGlite();
const migrations = loadMigrations(MIGRATIONS_DIR);

beforeEach(async () => {
  await client.exec("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
});

afterAll(async () => {
  await client.close();
});

async function names(sql: string): Promise<string[]> {
  const result = await client.query<{ name: string }>(sql);
  return result.rows.map((row) => row.name);
}

const userTables = () =>
  names(
    `SELECT table_name AS name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name <> 'schema_migrations' ORDER BY 1`,
  );
const userTypes = () =>
  names(
    `SELECT typname AS name FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
     WHERE n.nspname = 'public' AND t.typtype = 'e' ORDER BY 1`,
  );
const userFunctions = () =>
  names(
    `SELECT proname AS name FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' ORDER BY 1`,
  );

describe("loadMigrations", () => {
  it("reads the journal in order with up and down statements", () => {
    expect(migrations.map((migration) => migration.tag)).toEqual(EXPECTED_TAGS);
    for (const migration of migrations) {
      expect(migration.up.length).toBeGreaterThan(0);
      expect(migration.down.length).toBeGreaterThan(0);
    }
  });

  it("keeps a function body with semicolons as one statement", () => {
    const trigger = migrations[1];
    expect(trigger.up.some((statement) => statement.includes("CREATE FUNCTION"))).toBe(true);
    expect(trigger.up).toHaveLength(2);
  });
});

describe("migrateUp", () => {
  it("applies every migration to an empty database", async () => {
    expect(await migrateUp(client, migrations)).toEqual(EXPECTED_TAGS);
    expect(await appliedMigrations(client)).toEqual(EXPECTED_TAGS);
    expect(await userTables()).toEqual([
      "staples",
      "trip_item_progress",
      "trip_items",
      "trip_preferences",
      "trips",
      "users",
      "weather_suggestions",
    ]);
    expect(await userTypes()).toEqual([
      "item_category",
      "item_section",
      "staple_cadence",
      "weather_status",
    ]);
    expect(await userFunctions()).toEqual(["clamp_progress_to_qty"]);
  });

  it("is idempotent: a second run applies nothing", async () => {
    await migrateUp(client, migrations);
    expect(await migrateUp(client, migrations)).toEqual([]);
    expect(await appliedMigrations(client)).toEqual(EXPECTED_TAGS);
  });

  it("applies only what is pending", async () => {
    await migrateUp(client, migrations.slice(0, 1));
    expect(await migrateUp(client, migrations)).toEqual([EXPECTED_TAGS[1]]);
  });

  it("rolls a failing migration back completely and records nothing", async () => {
    const broken: Migration = {
      tag: "9999_broken",
      up: ['CREATE TABLE "half_made" ("id" integer)', 'INSERT INTO "does_not_exist" VALUES (1)'],
      down: [],
    };
    await expect(migrateUp(client, [migrations[0], broken])).rejects.toThrow(/does_not_exist/);
    expect(await appliedMigrations(client)).toEqual([EXPECTED_TAGS[0]]);
    const lookup = await client.query<{ name: string | null }>(
      `SELECT to_regclass('public.half_made')::text AS name`,
    );
    expect(lookup.rows[0].name).toBeNull();
    expect(await userTables()).toContain("trips");
  });
});

describe("migrateDown", () => {
  it("rolls everything back to an empty database, then migrates up again", async () => {
    await migrateUp(client, migrations);
    expect(await migrateDown(client, migrations)).toEqual([...EXPECTED_TAGS].reverse());
    expect(await appliedMigrations(client)).toEqual([]);
    expect(await userTables()).toEqual([]);
    expect(await userTypes()).toEqual([]);
    expect(await userFunctions()).toEqual([]);
    expect(await migrateUp(client, migrations)).toEqual(EXPECTED_TAGS);
  });

  it("rolls back only the requested number of steps, newest first", async () => {
    await migrateUp(client, migrations);
    expect(await migrateDown(client, migrations, 1)).toEqual([EXPECTED_TAGS[1]]);
    expect(await appliedMigrations(client)).toEqual([EXPECTED_TAGS[0]]);
    expect(await userFunctions()).toEqual([]);
    expect(await userTables()).toContain("trip_items");
  });

  it("does nothing on an empty database", async () => {
    expect(await migrateDown(client, migrations)).toEqual([]);
  });

  it("keeps the migration applied when its down fails", async () => {
    const broken: Migration = {
      tag: "0000_init",
      up: migrations[0].up,
      down: ['DROP TABLE "weather_suggestions"', 'DROP TABLE "nope"'],
    };
    await migrateUp(client, [broken]);
    await expect(migrateDown(client, [broken])).rejects.toThrow(/nope/);
    expect(await appliedMigrations(client)).toEqual(["0000_init"]);
    expect(await userTables()).toContain("weather_suggestions");
  });
});
