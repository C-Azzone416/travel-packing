import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createMigratedDb, resetData } from "@/server/db/__fixtures__/db";
import type { Db } from "@/server/db/retention";
import { beginAccountDeletion } from "./account-deletion";

let context: Awaited<ReturnType<typeof createMigratedDb>>;

beforeAll(async () => {
  context = await createMigratedDb();
});
beforeEach(async () => resetData(context.client));
afterAll(async () => context.client.close());

const OWNER = "synthetic-owner";
const OTHER = "synthetic-other";
const OWNER_DIGEST = "a".repeat(64);
const OTHER_DIGEST = "b".repeat(64);

async function seed(owner: string, digest: string, n: number) {
  const trip = `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const item = `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const list = `20000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const listItem = `30000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  await context.client.query("INSERT INTO users (id) VALUES ($1)", [owner]);
  await context.client.query("INSERT INTO account_setups (email_digest) VALUES ($1)", [digest]);
  await context.client.query(
    `INSERT INTO staples (owner_id, semantic_id, name, category, qty, cadence)
     VALUES ($1, $2, 'Synthetic item', 'Clothing', 1, 'per trip')`,
    [owner, `staple-${n}`],
  );
  await context.client.query("INSERT INTO saved_lists (id, owner_id, name) VALUES ($1, $2, $3)", [
    list,
    owner,
    `Synthetic list ${n}`,
  ]);
  await context.client.query(
    `INSERT INTO saved_list_items (id, list_id, owner_id, semantic_id, name, category, qty)
     VALUES ($1, $2, $3, $4, 'Synthetic list item', 'Clothing', 1)`,
    [listItem, list, owner, `list-item-${n}`],
  );
  await context.client.query(
    `INSERT INTO trips (id, owner_id, destination, start_date, end_date, days, daily_days, archived, deleted_at)
     VALUES ($1, $2, 'Synthetic City', '2030-01-01', '2030-01-02', 2, 2, true, now())`,
    [trip, owner],
  );
  await context.client.query(
    `INSERT INTO trip_stops (trip_id, owner_id, position, city, arrive_date, leave_date)
     VALUES ($1, $2, 0, 'Synthetic City', '2030-01-01', '2030-01-02')`,
    [trip, owner],
  );
  await context.client.query("INSERT INTO trip_preferences (trip_id, owner_id) VALUES ($1, $2)", [
    trip,
    owner,
  ]);
  await context.client.query(
    `INSERT INTO trip_items (id, trip_id, owner_id, semantic_id, name, category, qty)
     VALUES ($1, $2, $3, $4, 'Synthetic packed item', 'Clothing', 1)`,
    [item, trip, owner, `trip-item-${n}`],
  );
  await context.client.query(
    `INSERT INTO trip_item_progress (item_id, trip_id, owner_id, qty, packed)
     VALUES ($1, $2, $3, 1, 1)`,
    [item, trip, owner],
  );
  await context.client.query(
    `INSERT INTO weather_suggestions (trip_id, owner_id, suggestion_semantic_id)
     VALUES ($1, $2, $3)`,
    [trip, owner, `weather-${n}`],
  );
}

async function count(table: string, owner: string): Promise<number> {
  const result = await context.client.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM ${table} WHERE owner_id = $1`,
    [owner],
  );
  return Number(result.rows[0].count);
}

describe("beginAccountDeletion", () => {
  it("fences the provider id and removes every owned row, including soft-deleted data, without another owner", async () => {
    await seed(OWNER, OWNER_DIGEST, 1);
    await seed(OTHER, OTHER_DIGEST, 2);

    await beginAccountDeletion(context.db as unknown as Db, OWNER, OWNER_DIGEST);

    expect(
      (await context.client.query("SELECT user_id FROM account_deletions ORDER BY user_id")).rows,
    ).toEqual([{ user_id: OWNER }]);
    expect((await context.client.query("SELECT id FROM users ORDER BY id")).rows).toEqual([
      { id: OTHER },
    ]);
    expect((await context.client.query("SELECT email_digest FROM account_setups")).rows).toEqual([
      { email_digest: OTHER_DIGEST },
    ]);
    for (const table of [
      "staples",
      "saved_lists",
      "saved_list_items",
      "trips",
      "trip_stops",
      "trip_preferences",
      "trip_items",
      "trip_item_progress",
      "weather_suggestions",
    ]) {
      expect(await count(table, OWNER), table).toBe(0);
      expect(await count(table, OTHER), table).toBe(1);
    }
  });

  it("is idempotent", async () => {
    await seed(OWNER, OWNER_DIGEST, 1);
    await beginAccountDeletion(context.db as unknown as Db, OWNER, OWNER_DIGEST);
    await expect(
      beginAccountDeletion(context.db as unknown as Db, OWNER, OWNER_DIGEST),
    ).resolves.toBeUndefined();
    expect(
      (await context.client.query("SELECT count(*)::int AS count FROM account_deletions")).rows,
    ).toEqual([{ count: 1 }]);
  });
});
