import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createMigratedDb, resetData } from "@/server/db/__fixtures__/db";
import type { Db } from "@/server/db/retention";
import {
  beginAccountDeletion,
  completeAccountDeletion,
  reconcileAccountDeletion,
  reconcilePendingAccountDeletions,
} from "./account-deletion";

let context: Awaited<ReturnType<typeof createMigratedDb>>;

beforeAll(async () => {
  context = await createMigratedDb();
  await context.client.exec(
    'CREATE SCHEMA neon_auth; CREATE TABLE neon_auth."user" (id text PRIMARY KEY, "createdAt" timestamp with time zone NOT NULL)',
  );
});
beforeEach(async () => {
  vi.stubEnv("CLOSE_ACCOUNT_ENABLED", "1");
  await resetData(context.client);
  await context.client.exec('TRUNCATE TABLE "account_deletions", "account_setups"');
  await context.client.exec('TRUNCATE TABLE neon_auth."user"');
});
afterEach(() => vi.unstubAllEnvs());
afterAll(async () => context.client.close());

const OWNER = "synthetic-owner";
const OTHER = "synthetic-other";
const OWNER_DIGEST = "a".repeat(64);
const OTHER_DIGEST = "b".repeat(64);
const IDENTITY_CREATED_AT = 1_700_000_000_000;

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

    await beginAccountDeletion(
      context.db as unknown as Db,
      OWNER,
      IDENTITY_CREATED_AT,
      OWNER_DIGEST,
    );

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
    await beginAccountDeletion(
      context.db as unknown as Db,
      OWNER,
      IDENTITY_CREATED_AT,
      OWNER_DIGEST,
    );
    await expect(
      beginAccountDeletion(context.db as unknown as Db, OWNER, IDENTITY_CREATED_AT, OWNER_DIGEST),
    ).resolves.toBe("started");
    expect(
      (await context.client.query("SELECT count(*)::int AS count FROM account_deletions")).rows,
    ).toEqual([{ count: 1 }]);
  });

  it("does not delete a different identity incarnation when the provider reuses a user id", async () => {
    await seed(OWNER, OWNER_DIGEST, 1);
    await beginAccountDeletion(
      context.db as unknown as Db,
      OWNER,
      IDENTITY_CREATED_AT,
      OWNER_DIGEST,
    );
    await context.client.query("INSERT INTO users (id) VALUES ($1)", [OWNER]);
    await context.client.query("INSERT INTO account_setups (email_digest) VALUES ($1)", [
      OWNER_DIGEST,
    ]);

    await expect(
      beginAccountDeletion(
        context.db as unknown as Db,
        OWNER,
        IDENTITY_CREATED_AT + 1,
        OWNER_DIGEST,
      ),
    ).resolves.toBe("identity-mismatch");

    expect((await context.client.query("SELECT id FROM users")).rows).toEqual([{ id: OWNER }]);
    expect((await context.client.query("SELECT email_digest FROM account_setups")).rows).toEqual([
      { email_digest: OWNER_DIGEST },
    ]);
  });
});

describe("completeAccountDeletion", () => {
  it("does a final cascade sweep and removes the transient fence after provider confirmation", async () => {
    await seed(OWNER, OWNER_DIGEST, 1);
    await beginAccountDeletion(
      context.db as unknown as Db,
      OWNER,
      IDENTITY_CREATED_AT,
      OWNER_DIGEST,
    );
    // Model a request that was already authorized before deletion and recreated the owner before terminal cleanup.
    await context.client.query("INSERT INTO users (id) VALUES ($1)", [OWNER]);
    // Model a reset that completed after the initial sweep but before provider confirmation.
    await context.client.query("INSERT INTO account_setups (email_digest) VALUES ($1)", [
      OWNER_DIGEST,
    ]);

    await expect(
      completeAccountDeletion(
        context.db as unknown as Db,
        OWNER,
        IDENTITY_CREATED_AT,
        OWNER_DIGEST,
      ),
    ).resolves.toBe("completed");

    expect((await context.client.query("SELECT * FROM users")).rows).toEqual([]);
    expect((await context.client.query("SELECT * FROM account_deletions")).rows).toEqual([]);
    expect((await context.client.query("SELECT * FROM account_setups")).rows).toEqual([]);
  });

  it("cannot sweep a new identity incarnation while finishing an older deletion", async () => {
    await seed(OWNER, OWNER_DIGEST, 1);
    await beginAccountDeletion(
      context.db as unknown as Db,
      OWNER,
      IDENTITY_CREATED_AT,
      OWNER_DIGEST,
    );
    await context.client.query("INSERT INTO users (id) VALUES ($1)", [OWNER]);

    await expect(
      completeAccountDeletion(
        context.db as unknown as Db,
        OWNER,
        IDENTITY_CREATED_AT + 1,
        OWNER_DIGEST,
      ),
    ).resolves.toBe("identity-mismatch");

    expect((await context.client.query("SELECT id FROM users")).rows).toEqual([{ id: OWNER }]);
    expect((await context.client.query("SELECT user_id FROM account_deletions")).rows).toEqual([
      { user_id: OWNER },
    ]);
  });

  it("is an idempotent no-op without a fence and never deletes a later account with a reused provider id", async () => {
    await context.client.query("INSERT INTO users (id) VALUES ($1)", [OWNER]);
    await expect(
      completeAccountDeletion(
        context.db as unknown as Db,
        OWNER,
        IDENTITY_CREATED_AT,
        OWNER_DIGEST,
      ),
    ).resolves.toBe("absent");
    await expect(
      completeAccountDeletion(
        context.db as unknown as Db,
        OWNER,
        IDENTITY_CREATED_AT,
        OWNER_DIGEST,
      ),
    ).resolves.toBe("absent");
    expect((await context.client.query("SELECT id FROM users")).rows).toEqual([{ id: OWNER }]);
  });
});

describe("reconcileAccountDeletion", () => {
  it("does not query or erase a fence while rollout is off", async () => {
    const execute = vi.fn();
    vi.stubEnv("CLOSE_ACCOUNT_ENABLED", "");
    await expect(
      reconcileAccountDeletion(
        { execute } as unknown as Db,
        OWNER,
        IDENTITY_CREATED_AT,
        OWNER_DIGEST,
      ),
    ).resolves.toBe("unavailable");
    expect(execute).not.toHaveBeenCalled();
  });

  it("does no bounded candidate query or cleanup while rollout is off", async () => {
    const execute = vi.fn();
    vi.stubEnv("CLOSE_ACCOUNT_ENABLED", "invalid");
    await expect(reconcilePendingAccountDeletions({ execute } as unknown as Db)).resolves.toEqual({
      completed: 0,
      pending: 0,
      unavailable: 0,
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it("keeps the fence while the exact provider identity still exists", async () => {
    await seed(OWNER, OWNER_DIGEST, 1);
    await beginAccountDeletion(
      context.db as unknown as Db,
      OWNER,
      IDENTITY_CREATED_AT,
      OWNER_DIGEST,
    );
    await context.client.query('INSERT INTO neon_auth."user" (id, "createdAt") VALUES ($1, $2)', [
      OWNER,
      new Date(IDENTITY_CREATED_AT),
    ]);

    await expect(
      reconcileAccountDeletion(
        context.db as unknown as Db,
        OWNER,
        IDENTITY_CREATED_AT,
        OWNER_DIGEST,
      ),
    ).resolves.toBe("pending");
    expect((await context.client.query("SELECT user_id FROM account_deletions")).rows).toEqual([
      { user_id: OWNER },
    ]);
  });

  it("finishes cleanup when the exact provider identity is authoritatively absent", async () => {
    await seed(OWNER, OWNER_DIGEST, 1);
    await beginAccountDeletion(
      context.db as unknown as Db,
      OWNER,
      IDENTITY_CREATED_AT,
      OWNER_DIGEST,
    );

    await expect(
      reconcileAccountDeletion(
        context.db as unknown as Db,
        OWNER,
        IDENTITY_CREATED_AT,
        OWNER_DIGEST,
      ),
    ).resolves.toBe("completed");
    expect((await context.client.query("SELECT * FROM account_deletions")).rows).toEqual([]);
  });

  it("can finish the old fence without targeting a provider identity that reused its id", async () => {
    await seed(OWNER, OWNER_DIGEST, 1);
    await beginAccountDeletion(
      context.db as unknown as Db,
      OWNER,
      IDENTITY_CREATED_AT,
      OWNER_DIGEST,
    );
    await context.client.query('INSERT INTO neon_auth."user" (id, "createdAt") VALUES ($1, $2)', [
      OWNER,
      new Date(IDENTITY_CREATED_AT + 1),
    ]);

    await expect(
      reconcileAccountDeletion(
        context.db as unknown as Db,
        OWNER,
        IDENTITY_CREATED_AT,
        OWNER_DIGEST,
      ),
    ).resolves.toBe("completed");
    expect((await context.client.query("SELECT * FROM account_deletions")).rows).toEqual([]);
    expect((await context.client.query('SELECT id FROM neon_auth."user"')).rows).toEqual([
      { id: OWNER },
    ]);
  });

  it("fails closed when authoritative provider state is unavailable", async () => {
    await seed(OWNER, OWNER_DIGEST, 1);
    await beginAccountDeletion(
      context.db as unknown as Db,
      OWNER,
      IDENTITY_CREATED_AT,
      OWNER_DIGEST,
    );
    const unavailable = new Proxy(context.db as unknown as Db, {
      get(target, property, receiver) {
        if (property === "execute") return async () => Promise.reject(new Error("denied"));
        const value = Reflect.get(target, property, receiver) as unknown;
        return typeof value === "function" ? value.bind(target) : value;
      },
    });

    await expect(
      reconcileAccountDeletion(unavailable, OWNER, IDENTITY_CREATED_AT, OWNER_DIGEST),
    ).resolves.toBe("unavailable");
    expect((await context.client.query("SELECT user_id FROM account_deletions")).rows).toEqual([
      { user_id: OWNER },
    ]);
  });

  it("does not reconcile a fence against mismatched generation input", async () => {
    await seed(OWNER, OWNER_DIGEST, 1);
    await beginAccountDeletion(
      context.db as unknown as Db,
      OWNER,
      IDENTITY_CREATED_AT,
      OWNER_DIGEST,
    );

    await expect(
      reconcileAccountDeletion(
        context.db as unknown as Db,
        OWNER,
        IDENTITY_CREATED_AT + 1,
        OWNER_DIGEST,
      ),
    ).resolves.toBe("unavailable");
    expect((await context.client.query("SELECT user_id FROM account_deletions")).rows).toEqual([
      { user_id: OWNER },
    ]);
  });

  it("reconciles a bounded batch without removing an identity that is still present", async () => {
    await seed(OWNER, OWNER_DIGEST, 1);
    await seed(OTHER, OTHER_DIGEST, 2);
    await beginAccountDeletion(
      context.db as unknown as Db,
      OWNER,
      IDENTITY_CREATED_AT,
      OWNER_DIGEST,
    );
    await beginAccountDeletion(
      context.db as unknown as Db,
      OTHER,
      IDENTITY_CREATED_AT + 1,
      OTHER_DIGEST,
    );
    await context.client.query('INSERT INTO neon_auth."user" (id, "createdAt") VALUES ($1, $2)', [
      OTHER,
      new Date(IDENTITY_CREATED_AT + 1),
    ]);

    await expect(reconcilePendingAccountDeletions(context.db as unknown as Db)).resolves.toEqual({
      completed: 1,
      pending: 0,
      unavailable: 0,
    });
    expect((await context.client.query("SELECT user_id FROM account_deletions")).rows).toEqual([
      { user_id: OTHER },
    ]);
  });

  it("rotates failed candidates so one bounded batch cannot starve later cleanup", async () => {
    const ids = ["a-owner", "b-owner", "c-owner", "d-owner"];
    for (const [index, userId] of ids.entries()) {
      await context.client.query(
        "INSERT INTO account_deletions (user_id, identity_created_at, setup_email_digest) VALUES ($1, $2, $3)",
        [userId, new Date(IDENTITY_CREATED_AT + index), String(index).repeat(64)],
      );
    }
    let failures = 2;
    const rotating = new Proxy(context.db as unknown as Db, {
      get(target, property, receiver) {
        if (property === "transaction") {
          return async (work: Parameters<Db["transaction"]>[0]) => {
            if (failures > 0) {
              failures -= 1;
              throw new Error("synthetic cleanup outage");
            }
            return context.db.transaction(work);
          };
        }
        const value = Reflect.get(target, property, receiver) as unknown;
        return typeof value === "function" ? value.bind(target) : value;
      },
    });

    await expect(reconcilePendingAccountDeletions(rotating, 2)).resolves.toEqual({
      completed: 0,
      pending: 0,
      unavailable: 2,
    });
    await expect(reconcilePendingAccountDeletions(rotating, 2)).resolves.toEqual({
      completed: 2,
      pending: 0,
      unavailable: 0,
    });
    expect(
      (await context.client.query("SELECT user_id FROM account_deletions ORDER BY user_id")).rows,
    ).toEqual([{ user_id: "a-owner" }, { user_id: "b-owner" }]);
    await expect(reconcilePendingAccountDeletions(rotating, 2)).resolves.toEqual({
      completed: 0,
      pending: 0,
      unavailable: 0,
    });
  });

  it("fails closed when the bounded candidate query is unavailable or malformed", async () => {
    const unavailable = {
      execute: async () => Promise.reject(new Error("permission denied")),
    } as unknown as Db;
    await expect(reconcilePendingAccountDeletions(unavailable)).resolves.toEqual({
      completed: 0,
      pending: 0,
      unavailable: 1,
    });

    const malformed = {
      execute: async () => ({
        rows: [
          {
            userId: "synthetic-owner",
            identityCreatedAt: "not-a-timestamp",
            setupEmailDigest: OWNER_DIGEST,
          },
        ],
      }),
    } as unknown as Db;
    await expect(reconcilePendingAccountDeletions(malformed)).resolves.toEqual({
      completed: 0,
      pending: 0,
      unavailable: 1,
    });
  });
});
