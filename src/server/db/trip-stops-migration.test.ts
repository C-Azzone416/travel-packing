// Migration 0005 on a real (in-memory) Postgres: existing trips are backfilled to exactly one stop, the umbrella
// suggestion survives the re-keying, and the new rules hold. Synthetic data only.

import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { MIGRATIONS_DIR } from "./__fixtures__/db";
import { loadMigrations, migrateDown, migrateUp } from "./migrator";

const client = new PGlite();
const migrations = loadMigrations(MIGRATIONS_DIR);
const BEFORE = migrations.slice(0, 5);
const TRIP = "00000000-0000-4000-8000-000000000001";
const TRIP_2 = "00000000-0000-4000-8000-000000000002";

beforeEach(async () => {
  await client.exec("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
});
afterAll(async () => {
  await client.close();
});

const rows = async <T = Record<string, unknown>>(sql: string) => (await client.query<T>(sql)).rows;

async function seedBefore(): Promise<void> {
  await migrateUp(client, BEFORE);
  await client.exec(`INSERT INTO users (id) VALUES ('owner-a')`);
  await client.exec(`
    INSERT INTO trips (id, owner_id, destination, location_id, location_label, location_provider, location_place_id,
      location_region, location_country, location_country_code, latitude, longitude, timezone,
      start_date, end_date, days, daily_days)
    VALUES ('${TRIP}', 'owner-a', 'Exampleville', 'open-meteo-1', 'Exampleville, Sample Region, Sampleland',
      'open-meteo', '1', 'Sample Region', 'Sampleland', 'SL', 12.35, -45.68, 'Etc/UTC',
      '2030-05-01', '2030-05-04', 4, 2),
      ('${TRIP_2}', 'owner-a', 'Dayville', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
      '2030-06-01', '2030-06-01', 1, 0)`);
  await client.exec(`
    INSERT INTO weather_suggestions (trip_id, owner_id, status, label)
    VALUES ('${TRIP}', 'owner-a', 'accepted', 'Close forecast')`);
}

describe("0005_trip_stops", () => {
  it("backfills exactly one stop per existing trip with the same dates and location", async () => {
    await seedBefore();
    await migrateUp(client, migrations);

    const stops = await rows(
      `SELECT trip_id, position, city, location_id, location_label, location_provider, location_place_id,
        location_region, location_country, location_country_code, latitude::float AS latitude,
        longitude::float AS longitude, timezone, arrive_date::text AS arrive, leave_date::text AS leave
       FROM trip_stops ORDER BY trip_id`,
    );
    expect(stops).toEqual([
      {
        trip_id: TRIP,
        position: 0,
        city: "Exampleville",
        location_id: "open-meteo-1",
        location_label: "Exampleville, Sample Region, Sampleland",
        location_provider: "open-meteo",
        location_place_id: "1",
        location_region: "Sample Region",
        location_country: "Sampleland",
        location_country_code: "SL",
        latitude: 12.35,
        longitude: -45.68,
        timezone: "Etc/UTC",
        arrive: "2030-05-01",
        leave: "2030-05-04",
      },
      expect.objectContaining({
        trip_id: TRIP_2,
        position: 0,
        city: "Dayville",
        location_id: null,
        latitude: null,
        arrive: "2030-06-01",
        leave: "2030-06-01",
      }),
    ]);
  });

  it("keeps the umbrella suggestion row, re-keyed by (trip, semantic id), with an empty rule signature", async () => {
    await seedBefore();
    await migrateUp(client, migrations);
    expect(
      await rows(
        `SELECT trip_id, suggestion_semantic_id, status, label, rule_signature FROM weather_suggestions`,
      ),
    ).toEqual([
      {
        trip_id: TRIP,
        suggestion_semantic_id: "weather-umbrella",
        status: "accepted",
        label: "Close forecast",
        rule_signature: "",
      },
    ]);
    await client.exec(
      `INSERT INTO weather_suggestions (trip_id, owner_id, suggestion_semantic_id, status, rule_signature)
       VALUES ('${TRIP}', 'owner-a', 'weather-rain-jacket', 'skipped', 'rain>=2d')`,
    );
    await expect(
      client.exec(
        `INSERT INTO weather_suggestions (trip_id, owner_id, suggestion_semantic_id, label)
         VALUES ('${TRIP}', 'owner-a', 'weather-rain-jacket', 'x')`,
      ),
    ).rejects.toThrow();
  });

  it("gives every user weather off and Fahrenheit, and refuses another unit", async () => {
    await seedBefore();
    await migrateUp(client, migrations);
    expect(await rows(`SELECT weather_opt_in, temperature_unit FROM users`)).toEqual([
      { weather_opt_in: false, temperature_unit: "F" },
    ]);
    await expect(client.exec(`UPDATE users SET temperature_unit = 'K'`)).rejects.toThrow();
  });

  it("enforces the stop rules in the database", async () => {
    await seedBefore();
    await migrateUp(client, migrations);
    const insert = (columns: string, values: string) =>
      client.exec(
        `INSERT INTO trip_stops (trip_id, owner_id, position, city, arrive_date, leave_date${columns})
         VALUES ('${TRIP}', 'owner-a', ${values})`,
      );
    // unique (trip_id, position)
    await expect(insert("", `0, 'Dup', '2030-05-04', '2030-05-06'`)).rejects.toThrow();
    // leave before arrive
    await expect(insert("", `1, 'Back', '2030-05-06', '2030-05-04'`)).rejects.toThrow();
    // blank city, negative position
    await expect(insert("", `1, '  ', '2030-05-04', '2030-05-06'`)).rejects.toThrow();
    await expect(insert("", `-1, 'Neg', '2030-05-04', '2030-05-06'`)).rejects.toThrow();
    // coordinates: pair, range, and only with a provider
    await expect(
      insert(", latitude", `1, 'Lat', '2030-05-04', '2030-05-06', 10`),
    ).rejects.toThrow();
    await expect(
      insert(
        ", latitude, longitude, location_provider, location_place_id",
        `1, 'Range', '2030-05-04', '2030-05-06', 95, 10, 'p', '1'`,
      ),
    ).rejects.toThrow();
    await expect(
      insert(", latitude, longitude", `1, 'NoProv', '2030-05-04', '2030-05-06', 10, 10`),
    ).rejects.toThrow();
    await expect(
      insert(", location_provider", `1, 'Half', '2030-05-04', '2030-05-06', 'p'`),
    ).rejects.toThrow();
    await expect(
      insert(", location_country_code", `1, 'Code', '2030-05-04', '2030-05-06', 'USA'`),
    ).rejects.toThrow();
    // a valid second stop is fine
    await insert("", `1, 'Second', '2030-05-04', '2030-05-06'`);
    expect(
      await rows(`SELECT count(*)::int AS n FROM trip_stops WHERE trip_id = '${TRIP}'`),
    ).toEqual([{ n: 2 }]);
  });

  it("refuses a stop under another owner's trip, and cascades with the trip", async () => {
    await seedBefore();
    await migrateUp(client, migrations);
    await client.exec(`INSERT INTO users (id) VALUES ('owner-b')`);
    await expect(
      client.exec(
        `INSERT INTO trip_stops (trip_id, owner_id, position, city, arrive_date, leave_date)
         VALUES ('${TRIP}', 'owner-b', 5, 'Hijack', '2030-05-01', '2030-05-02')`,
      ),
    ).rejects.toThrow();
    await client.exec(`DELETE FROM trips WHERE id = '${TRIP}'`);
    expect(await rows(`SELECT trip_id FROM trip_stops`)).toEqual([{ trip_id: TRIP_2 }]);
  });

  it("rolls back to the single-key suggestion table and up again, keeping the umbrella", async () => {
    await seedBefore();
    await migrateUp(client, migrations);
    await client.exec(
      `INSERT INTO weather_suggestions (trip_id, owner_id, suggestion_semantic_id, status, rule_signature)
       VALUES ('${TRIP}', 'owner-a', 'weather-rain-jacket', 'skipped', 'x')`,
    );
    expect(await migrateDown(client, migrations, 1)).toEqual(["0005_trip_stops"]);
    expect(await rows(`SELECT status FROM weather_suggestions WHERE trip_id = '${TRIP}'`)).toEqual([
      { status: "accepted" },
    ]);
    const tables = await rows<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`,
    );
    expect(tables.map((row) => row.table_name)).not.toContain("trip_stops");
    await migrateUp(client, migrations);
    expect(await rows(`SELECT count(*)::int AS n FROM trip_stops`)).toEqual([{ n: 2 }]);
  });
});
