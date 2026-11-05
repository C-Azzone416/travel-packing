// Migration 0014 (#378) on a real (in-memory) Postgres: the category -> cube backfill agrees with the domain's
// cubeForItem, Smart staples become per day plus the laundry flag (underwear and socks without it), existing trips keep
// their items and packed counts, and the migration rolls down and up again. Synthetic data only.

import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { cubeForItem } from "../../domain/cubes";
import { MIGRATIONS_DIR } from "./__fixtures__/db";
import { loadMigrations, migrateDown, migrateUp } from "./migrator";

const client = new PGlite();
const migrations = loadMigrations(MIGRATIONS_DIR);
const index = migrations.findIndex((migration) => migration.tag === "0014_suitcase_cubes_laundry");
const BEFORE = migrations.slice(0, index);
const THROUGH = migrations.slice(0, index + 1);
const TRIP = "00000000-0000-4000-8000-000000000014";

beforeEach(async () => {
  await client.exec("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
});
afterAll(async () => client.close());

const rows = async <T = Record<string, unknown>>(sql: string) => (await client.query<T>(sql)).rows;

interface Fixture {
  id: string;
  name: string;
  category: string;
  groupId?: string;
}

// Every category, plus the identity-driven cases: toiletry-bag contents, weather identities, documents vs misc under
// "Other essentials", and Pack last items that must keep a real cube.
const FIXTURES: Fixture[] = [
  { id: "tops", name: "Everyday tops", category: "Clothing" },
  { id: "nice-top", name: "Nice-attire top", category: "Nice attire" },
  { id: "return-top", name: "Fresh top", category: "Return outfit" },
  { id: "toothpaste", name: "Toothpaste", category: "Bathroom", groupId: "toiletry-bag" },
  { id: "razor", name: "Razor", category: "Toiletries" },
  { id: "medicine", name: "Medication", category: "Bathroom" },
  { id: "laptop", name: "Laptop", category: "Tech" },
  { id: "travel-documents", name: "Travel documents", category: "Other essentials" },
  { id: "passport", name: "Passport", category: "Other essentials" },
  { id: "id-card", name: "ID", category: "Other essentials" },
  { id: "sunglasses", name: "Sunglasses", category: "Other essentials" },
  { id: "neck-pillow", name: "Neck pillow", category: "Other essentials" },
  { id: "sun-hat", name: "Sun hat", category: "Accessories" },
  { id: "scarf", name: "Scarf", category: "Accessories" },
  { id: "weather-umbrella", name: "Compact umbrella", category: "Weather suggestion" },
  { id: "weather-rain-jacket", name: "Rain jacket", category: "Clothing" },
  { id: "umbrella", name: "Umbrella", category: "Accessories" },
  { id: "weather-sunscreen", name: "Sunscreen", category: "Bathroom", groupId: "toiletry-bag" },
  { id: "chargers", name: "Chargers", category: "Pack last" },
  { id: "boarding-pass", name: "Boarding pass", category: "Pack last" },
  { id: "keys", name: "House keys", category: "Pack last" },
];

async function seedBefore(): Promise<void> {
  await migrateUp(client, BEFORE);
  await client.exec(`INSERT INTO users (id) VALUES ('owner-a')`);
  await client.exec(`
    INSERT INTO trips (id, owner_id, destination, start_date, end_date, days, daily_days)
    VALUES ('${TRIP}', 'owner-a', 'Exampleville', '2030-05-01', '2030-05-04', 4, 3)`);
  await client.exec(`
    INSERT INTO trip_preferences (trip_id, owner_id) VALUES ('${TRIP}', 'owner-a')`);
  for (const [position, fixture] of FIXTURES.entries()) {
    const group = fixture.groupId ? `'${fixture.groupId}'` : "NULL";
    await client.exec(`
      INSERT INTO staples (owner_id, semantic_id, name, category, qty, cadence, group_id)
      VALUES ('owner-a', '${fixture.id}', '${fixture.name}', '${fixture.category}', 1, 'per trip', ${group})`);
    await client.exec(`
      INSERT INTO trip_items (trip_id, owner_id, semantic_id, name, category, qty, group_id, sort_order)
      VALUES ('${TRIP}', 'owner-a', '${fixture.id}', '${fixture.name}', '${fixture.category}', 3, ${group}, ${position})`);
    await client.exec(`
      INSERT INTO trip_item_progress (item_id, trip_id, owner_id, qty, packed)
      SELECT id, trip_id, owner_id, qty, ${position % 4} FROM trip_items WHERE semantic_id = '${fixture.id}'`);
  }
}

describe("0014_suitcase_cubes_laundry", () => {
  it("follows 0013", () => {
    expect(index).toBeGreaterThan(0);
    expect(migrations[index - 1].tag).toBe("0013_flimsy_redwing");
  });

  it("backfills every staple and trip item to the cube the domain mapping gives", async () => {
    await seedBefore();
    await migrateUp(client, THROUGH);
    const staples = await rows<{ semantic_id: string; cube: string }>(
      `SELECT semantic_id, cube FROM staples`,
    );
    const items = await rows<{ semantic_id: string; cube: string }>(
      `SELECT semantic_id, cube FROM trip_items`,
    );
    for (const fixture of FIXTURES) {
      const expected = cubeForItem(fixture);
      expect(staples.find((row) => row.semantic_id === fixture.id)?.cube, fixture.id).toBe(
        expected,
      );
      expect(items.find((row) => row.semantic_id === fixture.id)?.cube, fixture.id).toBe(expected);
    }
  });

  it("pins the mapping table", async () => {
    await seedBefore();
    await migrateUp(client, THROUGH);
    const cubes = Object.fromEntries(
      (
        await rows<{ semantic_id: string; cube: string }>(`SELECT semantic_id, cube FROM staples`)
      ).map((row) => [row.semantic_id, row.cube]),
    );
    expect(cubes).toEqual({
      tops: "clothing",
      "nice-top": "clothing",
      "return-top": "clothing",
      toothpaste: "toiletries",
      razor: "toiletries",
      medicine: "toiletries",
      laptop: "tech",
      "travel-documents": "documents",
      passport: "documents",
      "id-card": "documents",
      sunglasses: "misc",
      "neck-pillow": "misc",
      "sun-hat": "weather",
      scarf: "misc",
      "weather-umbrella": "weather",
      "weather-rain-jacket": "weather",
      umbrella: "weather",
      "weather-sunscreen": "toiletries",
      chargers: "tech",
      "boarding-pass": "documents",
      keys: "misc",
    });
  });

  it("keeps every existing trip item, quantity and packed count", async () => {
    await seedBefore();
    const before = await rows(
      `SELECT i.semantic_id, i.name, i.qty, i.section, p.packed FROM trip_items i
       JOIN trip_item_progress p ON p.item_id = i.id ORDER BY i.semantic_id`,
    );
    await migrateUp(client, THROUGH);
    const after = await rows(
      `SELECT i.semantic_id, i.name, i.qty, i.section, p.packed FROM trip_items i
       JOIN trip_item_progress p ON p.item_id = i.id ORDER BY i.semantic_id`,
    );
    expect(after).toEqual(before);
    expect(after).toHaveLength(FIXTURES.length);
    expect(
      await rows(
        `SELECT laundry_halves, staple_qty FROM trip_items GROUP BY laundry_halves, staple_qty`,
      ),
    ).toEqual([{ laundry_halves: false, staple_qty: null }]);
  });

  it("flags Toiletries Morning of on existing trips", async () => {
    await seedBefore();
    await migrateUp(client, THROUGH);
    expect(
      await rows(`SELECT morning_of_cubes::text AS morning_of_cubes FROM trip_preferences`),
    ).toEqual([{ morning_of_cubes: "{toiletries}" }]);
  });

  it("moves Smart staples to per day with the laundry flag, except underwear and socks", async () => {
    await migrateUp(client, BEFORE);
    await client.exec(`INSERT INTO users (id) VALUES ('owner-a')`);
    await client.exec(`
      INSERT INTO staples (owner_id, semantic_id, name, category, qty, cadence) VALUES
        ('owner-a', 'tops', 'Tops', 'Clothing', 1, 'smart'),
        ('owner-a', 'bottoms', 'Bottoms', 'Clothing', 1, 'smart'),
        ('owner-a', 'underwear', 'Underwear', 'Clothing', 1, 'smart'),
        ('owner-a', 'socks', 'Socks', 'Clothing', 1, 'smart'),
        ('owner-a', 'sleepwear', 'Sleepwear', 'Clothing', 1, 'smart'),
        ('owner-a', 'nice-top', 'Nice top', 'Nice attire', 1, 'smart'),
        ('owner-a', 'medicine', 'Medication', 'Bathroom', 1, 'per day'),
        ('owner-a', 'chargers', 'Chargers', 'Tech', 1, 'per trip')`);
    await migrateUp(client, THROUGH);
    expect(
      await rows(`SELECT semantic_id, cadence, laundry_halves FROM staples ORDER BY semantic_id`),
    ).toEqual([
      { semantic_id: "bottoms", cadence: "per day", laundry_halves: true },
      { semantic_id: "chargers", cadence: "per trip", laundry_halves: false },
      { semantic_id: "medicine", cadence: "per day", laundry_halves: false },
      { semantic_id: "nice-top", cadence: "smart", laundry_halves: false },
      { semantic_id: "sleepwear", cadence: "smart", laundry_halves: false },
      { semantic_id: "socks", cadence: "per day", laundry_halves: false },
      { semantic_id: "tops", cadence: "per day", laundry_halves: true },
      { semantic_id: "underwear", cadence: "per day", laundry_halves: false },
    ]);
  });

  it("leaves Smart snapshots on existing trips alone", async () => {
    await seedBefore();
    await client.exec(`UPDATE trip_items SET staple_cadence = 'smart' WHERE semantic_id = 'tops'`);
    await migrateUp(client, THROUGH);
    expect(await rows(`SELECT staple_cadence FROM trip_items WHERE semantic_id = 'tops'`)).toEqual([
      { staple_cadence: "smart" },
    ]);
  });

  it("refuses the laundry flag on underwear and socks at the database", async () => {
    await migrateUp(client, THROUGH);
    await client.exec(`INSERT INTO users (id) VALUES ('owner-a')`);
    for (const id of ["underwear", "socks"]) {
      await expect(
        client.exec(`
          INSERT INTO staples (owner_id, semantic_id, name, category, qty, cadence, laundry_halves, cube)
          VALUES ('owner-a', '${id}', 'x', 'Clothing', 1, 'per day', true, 'clothing')`),
      ).rejects.toThrow("staples_laundry_not_underwear_socks");
    }
    await client.exec(`
      INSERT INTO staples (owner_id, semantic_id, name, category, qty, cadence, laundry_halves, cube)
      VALUES ('owner-a', 'tops', 'x', 'Clothing', 1, 'per night', true, 'clothing')`);
  });

  it("rolls down to the previous schema and can apply again", async () => {
    await seedBefore();
    await migrateUp(client, THROUGH);
    await client.exec(
      `UPDATE staples SET cadence = 'per night' WHERE semantic_id = 'medicine';
       UPDATE trip_items SET staple_cadence = 'per night' WHERE semantic_id = 'medicine'`,
    );
    expect(await migrateDown(client, THROUGH, 1)).toEqual(["0014_suitcase_cubes_laundry"]);
    expect(
      await rows(
        `SELECT column_name FROM information_schema.columns
         WHERE table_name IN ('staples', 'trip_items', 'trip_preferences')
         AND column_name IN ('cube', 'laundry_halves', 'staple_qty', 'morning_of_cubes')`,
      ),
    ).toEqual([]);
    expect(await rows(`SELECT cadence FROM staples WHERE semantic_id = 'medicine'`)).toEqual([
      { cadence: "per day" },
    ]);
    expect(
      await rows(`SELECT count(*)::int AS n FROM trip_items WHERE trip_id = '${TRIP}'`),
    ).toEqual([{ n: FIXTURES.length }]);
    await migrateUp(client, THROUGH);
    expect(await rows(`SELECT cube FROM staples WHERE semantic_id = 'passport'`)).toEqual([
      { cube: "documents" },
    ]);
  });

  it("restores Smart for laundry-flagged tops and bottoms when rolled down", async () => {
    await migrateUp(client, BEFORE);
    await client.exec(`INSERT INTO users (id) VALUES ('owner-a')`);
    await client.exec(`
      INSERT INTO staples (owner_id, semantic_id, name, category, qty, cadence)
      VALUES ('owner-a', 'tops', 'Tops', 'Clothing', 1, 'smart'),
             ('owner-a', 'underwear', 'Underwear', 'Clothing', 1, 'smart')`);
    await migrateUp(client, THROUGH);
    await migrateDown(client, THROUGH, 1);
    expect(await rows(`SELECT semantic_id, cadence FROM staples ORDER BY 1`)).toEqual([
      { semantic_id: "tops", cadence: "smart" },
      { semantic_id: "underwear", cadence: "per day" },
    ]);
  });
});
