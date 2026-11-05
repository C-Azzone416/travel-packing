// Migration 0015 (#379) on a real (in-memory) Postgres: existing users and trips are untouched (every new column null),
// the place checks hold, and the migration rolls down and up again. Synthetic data only.

import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { MIGRATIONS_DIR } from "./__fixtures__/db";
import { loadMigrations, migrateDown, migrateUp } from "./migrator";

const client = new PGlite();
const migrations = loadMigrations(MIGRATIONS_DIR);
const index = migrations.findIndex(
  (migration) => migration.tag === "0015_suitcase_home_origin_mode_name",
);
const BEFORE = migrations.slice(0, index);
const THROUGH = migrations.slice(0, index + 1);
const TRIP = "00000000-0000-4000-8000-000000000015";

beforeEach(async () => {
  await client.exec("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
});
afterAll(async () => client.close());

const rows = async <T = Record<string, unknown>>(sql: string) => (await client.query<T>(sql)).rows;

async function seedBefore(): Promise<void> {
  await migrateUp(client, BEFORE);
  await client.exec(
    `INSERT INTO users (id, weather_opt_in, appearance) VALUES ('owner-a', true, 'dusk')`,
  );
  await client.exec(`
    INSERT INTO trips (id, owner_id, destination, start_date, end_date, days, daily_days)
    VALUES ('${TRIP}', 'owner-a', 'Exampleville', '2030-05-01', '2030-05-04', 4, 3)`);
}

const failsWith = async (sql: string, constraint: string) => {
  await expect(client.exec(sql)).rejects.toThrow(constraint);
};

describe("0015_suitcase_home_origin_mode_name", () => {
  it("follows 0014", () => {
    expect(index).toBeGreaterThan(0);
    expect(migrations[index - 1].tag).toBe("0014_suitcase_cubes_laundry");
  });

  it("leaves existing users and trips untouched: no home city, origin, mode or name", async () => {
    await seedBefore();
    const user = await rows(`SELECT id, weather_opt_in, appearance FROM users`);
    const trip = await rows(
      `SELECT id, destination, start_date::text AS s, end_date::text AS e, days, daily_days FROM trips`,
    );
    await migrateUp(client, THROUGH);
    expect(await rows(`SELECT id, weather_opt_in, appearance FROM users`)).toEqual(user);
    expect(
      await rows(
        `SELECT id, destination, start_date::text AS s, end_date::text AS e, days, daily_days FROM trips`,
      ),
    ).toEqual(trip);
    const [row] = await rows<Record<string, unknown>>(`SELECT * FROM trips`);
    for (const [column, value] of Object.entries(row)) {
      if (column.startsWith("origin_") || column === "travel_mode" || column === "name") {
        expect(value, column).toBeNull();
      }
    }
    const [owner] = await rows<Record<string, unknown>>(`SELECT * FROM users`);
    for (const [column, value] of Object.entries(owner)) {
      if (column.startsWith("home_")) expect(value, column).toBeNull();
    }
  });

  it("stores a home city and a trip origin, mode and name", async () => {
    await seedBefore();
    await migrateUp(client, THROUGH);
    await client.exec(`
      UPDATE users SET home_city = 'Seattle', home_location_id = 'us-wa-seattle', home_location_label = 'Seattle, Washington, United States',
        home_location_region = 'Washington', home_location_country = 'United States', home_location_country_code = 'US'`);
    await client.exec(`
      UPDATE trips SET origin_city = 'Seattle', origin_location_provider = 'open-meteo', origin_location_place_id = '1',
        origin_latitude = 47.61, origin_longitude = -122.33, travel_mode = 'drive', name = 'Spring'`);
    expect(await rows(`SELECT home_city, travel_mode, name FROM users, trips`)).toEqual([
      { home_city: "Seattle", travel_mode: "drive", name: "Spring" },
    ]);
  });

  it("refuses a malformed place, mode or name", async () => {
    await seedBefore();
    await migrateUp(client, THROUGH);
    await failsWith(`UPDATE trips SET travel_mode = 'boat'`, "travel_mode");
    await failsWith(`UPDATE trips SET name = ' padded '`, "trips_name_valid");
    await failsWith(`UPDATE trips SET name = ''`, "trips_name_valid");
    await failsWith(`UPDATE trips SET name = '${"x".repeat(61)}'`, "trips_name_valid");
    await failsWith(
      `UPDATE trips SET origin_location_region = 'Orphan'`,
      "trips_origin_all_or_nothing",
    );
    await failsWith(`UPDATE trips SET origin_city = ' '`, "trips_origin_city_not_blank");
    await failsWith(
      `UPDATE trips SET origin_city = 'A', origin_location_provider = 'p', origin_location_place_id = '1', origin_latitude = 1`,
      "trips_origin_coordinates_pair",
    );
    await failsWith(
      `UPDATE trips SET origin_city = 'A', origin_latitude = 1, origin_longitude = 1`,
      "trips_origin_coordinates_need_provider",
    );
    await failsWith(
      `UPDATE trips SET origin_city = 'A', origin_location_provider = 'p'`,
      "trips_origin_provider_pair",
    );
    await failsWith(
      `UPDATE trips SET origin_city = 'A', origin_location_country_code = 'USA'`,
      "trips_origin_country_code_length",
    );
    await failsWith(
      `UPDATE users SET home_location_region = 'Orphan'`,
      "users_home_all_or_nothing",
    );
    await failsWith(`UPDATE users SET home_city = ''`, "users_home_city_not_blank");
    await failsWith(`UPDATE users SET home_city = '${"x".repeat(81)}'`, "users_home_city_short");
    await failsWith(
      `UPDATE users SET home_city = 'A', home_latitude = 91, home_longitude = 1, home_location_provider = 'p', home_location_place_id = '1'`,
      "users_home_latitude_range",
    );
  });

  it("deletes the home city and the trip origin with the account", async () => {
    await seedBefore();
    await migrateUp(client, THROUGH);
    await client.exec(`UPDATE users SET home_city = 'Seattle'`);
    await client.exec(`UPDATE trips SET origin_city = 'Seattle'`);
    await client.exec(`DELETE FROM users WHERE id = 'owner-a'`);
    expect(await rows(`SELECT home_city FROM users`)).toEqual([]);
    expect(await rows(`SELECT origin_city FROM trips`)).toEqual([]);
  });

  it("rolls down to 0014 (columns and type gone, other data kept) and up again", async () => {
    await seedBefore();
    await migrateUp(client, THROUGH);
    await client.exec(`UPDATE users SET home_city = 'Seattle'`);
    await client.exec(`UPDATE trips SET origin_city = 'Seattle', travel_mode = 'fly', name = 'x'`);
    expect(await migrateDown(client, THROUGH, 1)).toEqual(["0015_suitcase_home_origin_mode_name"]);
    expect(
      await rows(
        `SELECT column_name FROM information_schema.columns WHERE table_name IN ('users', 'trips') AND (column_name LIKE 'home\\_%' OR column_name LIKE 'origin\\_%' OR column_name IN ('travel_mode', 'name'))`,
      ),
    ).toEqual([]);
    expect(await rows(`SELECT 1 FROM pg_type WHERE typname = 'travel_mode'`)).toEqual([]);
    expect(await rows(`SELECT destination, days FROM trips`)).toEqual([
      { destination: "Exampleville", days: 4 },
    ]);
    await migrateUp(client, THROUGH);
    expect(await rows(`SELECT travel_mode, name, origin_city FROM trips`)).toEqual([
      { travel_mode: null, name: null, origin_city: null },
    ]);
  });
});
