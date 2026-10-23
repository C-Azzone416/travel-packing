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

const EXPECTED_TAGS = [
  "0000_init",
  "0001_progress_clamp_trigger",
  "0002_location_columns",
  "0003_trip_theme",
  "0004_account_setups",
  "0005_trip_stops",
  "0006_saved_lists",
  "0007_appearance",
  "0008_stamp_labels",
  "0009_staple_quantity_rules",
];

// One in-memory Postgres for the file; each test starts from an empty public schema.
const client = new PGlite();
const migrations = loadMigrations(MIGRATIONS_DIR);
// The set before trip stops (0005), for the tests that predate it.
const upToAccountSetups = migrations.slice(0, 5);

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
      "account_setups",
      "saved_list_items",
      "saved_lists",
      "staples",
      "trip_item_progress",
      "trip_items",
      "trip_preferences",
      "trip_stops",
      "trips",
      "users",
      "weather_suggestions",
    ]);
    expect(await userTypes()).toEqual([
      "item_category",
      "item_section",
      "staple_cadence",
      "trip_theme",
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
    expect(await migrateUp(client, migrations)).toEqual(EXPECTED_TAGS.slice(1));
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
    await migrateUp(client, upToAccountSetups);
    expect(await migrateDown(client, upToAccountSetups, 4)).toEqual([
      EXPECTED_TAGS[4],
      EXPECTED_TAGS[3],
      EXPECTED_TAGS[2],
      EXPECTED_TAGS[1],
    ]);
    expect(await appliedMigrations(client)).toEqual([EXPECTED_TAGS[0]]);
    expect(await userFunctions()).toEqual([]);
    expect(await userTables()).toContain("trip_items");
  });

  it("rolling back just the location columns removes them and keeps the earlier migrations, and up restores them", async () => {
    const tripColumns = async () =>
      (
        await client.query<{ column_name: string }>(
          `SELECT column_name FROM information_schema.columns WHERE table_name = 'trips'`,
        )
      ).rows.map((row) => row.column_name);
    const added = [
      "location_provider",
      "location_place_id",
      "location_region",
      "location_country",
      "location_country_code",
      "latitude",
      "longitude",
      "timezone",
    ];
    await migrateUp(client, upToAccountSetups);
    expect(await tripColumns()).toEqual(expect.arrayContaining(added));
    expect(await migrateDown(client, upToAccountSetups, 3)).toEqual([
      EXPECTED_TAGS[4],
      EXPECTED_TAGS[3],
      EXPECTED_TAGS[2],
    ]);
    const remaining = await tripColumns();
    for (const column of added) expect(remaining).not.toContain(column);
    expect(remaining).toEqual(
      expect.arrayContaining(["location_id", "location_label", "destination"]),
    );
    expect(await appliedMigrations(client)).toEqual(EXPECTED_TAGS.slice(0, 2));
    expect(await userFunctions()).toEqual(["clamp_progress_to_qty"]);
    await migrateUp(client, upToAccountSetups);
    expect(await tripColumns()).toEqual(expect.arrayContaining(added));
  });

  it("rolling back just the theme removes the column and its type, and up restores them with every old trip on Travel", async () => {
    const themeColumn = async () =>
      (
        await client.query<{ column_default: string | null; is_nullable: string }>(
          `SELECT column_default, is_nullable FROM information_schema.columns
           WHERE table_name = 'trips' AND column_name = 'theme'`,
        )
      ).rows;
    await migrateUp(client, migrations.slice(0, 3));
    await client.exec(
      `INSERT INTO "users" ("id") VALUES ('u1');
       INSERT INTO "trips" ("owner_id","destination","start_date","end_date","days","daily_days")
       VALUES ('u1','Anywhere','2030-04-01','2030-04-03',3,1)`,
    );
    await migrateUp(client, migrations.slice(0, 4));
    const [column] = await themeColumn();
    expect(column.is_nullable).toBe("NO");
    expect(column.column_default).toContain("travel");
    const old = await client.query<{ theme: string }>(`SELECT theme FROM trips`);
    expect(old.rows).toEqual([{ theme: "travel" }]);
    await expect(client.query(`UPDATE trips SET theme = 'volcano'`)).rejects.toThrow();
    expect(await migrateDown(client, migrations.slice(0, 4), 1)).toEqual([EXPECTED_TAGS[3]]);
    expect(await themeColumn()).toEqual([]);
    expect(await userTypes()).not.toContain("trip_theme");
    expect(await migrateUp(client, migrations.slice(0, 4))).toEqual([EXPECTED_TAGS[3]]);
  });

  it("rolling back just the account setups drops the table, and up restores it empty", async () => {
    await migrateUp(client, upToAccountSetups);
    await client.exec(`INSERT INTO "account_setups" ("email_digest") VALUES ('abc')`);
    expect(await migrateDown(client, upToAccountSetups, 1)).toEqual([EXPECTED_TAGS[4]]);
    expect(await userTables()).not.toContain("account_setups");
    expect(await migrateUp(client, upToAccountSetups)).toEqual([EXPECTED_TAGS[4]]);
    expect((await client.query(`SELECT * FROM "account_setups"`)).rows).toEqual([]);
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
