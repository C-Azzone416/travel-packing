// Migration 0007 on a real (in-memory) Postgres: existing owners get no saved theme (which reads as Base), the column
// takes any text, and rolling back drops it again. Synthetic data only.

import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { MIGRATIONS_DIR } from "./__fixtures__/db";
import { loadMigrations, migrateDown, migrateUp } from "./migrator";

const client = new PGlite();
const migrations = loadMigrations(MIGRATIONS_DIR);
const index = migrations.findIndex((migration) => migration.tag === "0007_appearance");

beforeEach(async () => {
  await client.exec("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
});
afterAll(async () => {
  await client.close();
});

const columns = async () =>
  (
    await client.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'users' ORDER BY 1`,
    )
  ).rows.map((row) => row.column_name);

describe("0007_appearance", () => {
  it("is the migration after saved lists", () => {
    expect(index).toBeGreaterThan(0);
    expect(migrations[index - 1].tag).toBe("0006_saved_lists");
  });

  it("adds a nullable appearance column; existing owners keep no saved theme", async () => {
    await migrateUp(client, migrations.slice(0, index));
    await client.exec(`INSERT INTO users (id) VALUES ('owner-a')`);
    expect(await columns()).not.toContain("appearance");

    await migrateUp(client, migrations.slice(0, index + 1));
    expect(await columns()).toContain("appearance");
    const before = await client.query(`SELECT appearance FROM users WHERE id = 'owner-a'`);
    expect(before.rows).toEqual([{ appearance: null }]);
    const saved = async () => (await client.query(`SELECT appearance FROM users`)).rows;
    await client.exec(`UPDATE users SET appearance = 'ocean' WHERE id = 'owner-a'`);
    expect(await saved()).toEqual([{ appearance: "ocean" }]);
    await client.exec(`UPDATE users SET appearance = 'from-a-newer-build' WHERE id = 'owner-a'`);
    expect(await saved()).toEqual([{ appearance: "from-a-newer-build" }]);
  });

  it("rolls back to the previous columns, keeping the owner, and up again", async () => {
    await migrateUp(client, migrations.slice(0, index + 1));
    await client.exec(`INSERT INTO users (id, appearance) VALUES ('owner-a', 'violet')`);
    expect(await migrateDown(client, migrations.slice(0, index + 1), 1)).toEqual([
      "0007_appearance",
    ]);
    expect(await columns()).not.toContain("appearance");
    expect((await client.query(`SELECT id FROM users`)).rows).toEqual([{ id: "owner-a" }]);
    await migrateUp(client, migrations.slice(0, index + 1));
    expect((await client.query(`SELECT appearance FROM users`)).rows).toEqual([
      { appearance: null },
    ]);
  });
});
