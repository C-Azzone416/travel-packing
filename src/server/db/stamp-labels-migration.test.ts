// Migration 0008 on a real (in-memory) Postgres: existing trips get no override (automatic), the columns take exactly three
// letters or numbers and nothing else, and rolling back drops them again. Synthetic data only.

import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { MIGRATIONS_DIR } from "./__fixtures__/db";
import { loadMigrations, migrateDown, migrateUp } from "./migrator";

const client = new PGlite();
const migrations = loadMigrations(MIGRATIONS_DIR);
const index = migrations.findIndex((migration) => migration.tag === "0008_stamp_labels");

beforeEach(async () => {
  await client.exec("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
});
afterAll(async () => {
  await client.close();
});

const columns = async () =>
  (
    await client.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'trips' ORDER BY 1`,
    )
  ).rows.map((row) => row.column_name);

const insertTrip = (label1: string | null, label2: string | null = null) =>
  client.query(
    `INSERT INTO trips (owner_id, destination, start_date, end_date, days, daily_days, stamp_label_1, stamp_label_2)
     VALUES ('owner-a', 'Lisbon', '2030-01-01', '2030-01-05', 5, 4, $1, $2)`,
    [label1, label2],
  );

describe("0008_stamp_labels", () => {
  it("is the migration after appearance", () => {
    expect(index).toBeGreaterThan(0);
    expect(migrations[index - 1].tag).toBe("0007_appearance");
  });

  it("adds two nullable columns; existing trips stay automatic (null, null)", async () => {
    await migrateUp(client, migrations.slice(0, index));
    await client.exec(`INSERT INTO users (id) VALUES ('owner-a')`);
    await client.exec(
      `INSERT INTO trips (owner_id, destination, start_date, end_date, days, daily_days)
       VALUES ('owner-a', 'Lisbon', '2030-01-01', '2030-01-05', 5, 4)`,
    );
    expect(await columns()).not.toContain("stamp_label_1");

    await migrateUp(client, migrations.slice(0, index + 1));
    expect(await columns()).toEqual(expect.arrayContaining(["stamp_label_1", "stamp_label_2"]));
    expect((await client.query(`SELECT stamp_label_1, stamp_label_2 FROM trips`)).rows).toEqual([
      { stamp_label_1: null, stamp_label_2: null },
    ]);
  });

  it("accepts exactly three of A-Z and 0-9, and refuses everything else", async () => {
    await migrateUp(client, migrations.slice(0, index + 1));
    await client.exec(`INSERT INTO users (id) VALUES ('owner-a')`);
    await insertTrip("ABC", "7X9");
    for (const bad of ["AB", "ABCD", "abc", "A C", "ÀBC", "A-C", ""]) {
      await expect(insertTrip(bad), JSON.stringify(bad)).rejects.toThrow(/stamp_label_1_format/);
      await expect(insertTrip(null, bad), JSON.stringify(bad)).rejects.toThrow(
        /stamp_label_2_format/,
      );
    }
  });

  it("rolls back to the previous columns, keeping the trip, and up again", async () => {
    await migrateUp(client, migrations.slice(0, index + 1));
    await client.exec(`INSERT INTO users (id) VALUES ('owner-a')`);
    await insertTrip("ABC");
    expect(await migrateDown(client, migrations.slice(0, index + 1), 1)).toEqual([
      "0008_stamp_labels",
    ]);
    expect(await columns()).not.toContain("stamp_label_1");
    expect((await client.query(`SELECT destination FROM trips`)).rows).toEqual([
      { destination: "Lisbon" },
    ]);
    await migrateUp(client, migrations.slice(0, index + 1));
    expect((await client.query(`SELECT stamp_label_1 FROM trips`)).rows).toEqual([
      { stamp_label_1: null },
    ]);
  });
});
