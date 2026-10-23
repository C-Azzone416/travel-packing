// Migration 0010 protects existing accounts while leaving genuinely new owners eligible for first-run setup.

import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { MIGRATIONS_DIR } from "./__fixtures__/db";
import { loadMigrations, migrateDown, migrateUp } from "./migrator";

const client = new PGlite();
const migrations = loadMigrations(MIGRATIONS_DIR);
const index = migrations.findIndex((migration) => migration.tag === "0010_staples_setup");

beforeEach(async () => {
  await client.exec("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
});
afterAll(async () => client.close());

describe("0010_staples_setup", () => {
  it("follows the shared quantity-rules migration", () => {
    expect(index).toBeGreaterThan(0);
    expect(migrations[index - 1].tag).toBe("0009_staple_quantity_rules");
  });

  it("marks existing owners skipped and defaults new owners to incomplete", async () => {
    await migrateUp(client, migrations.slice(0, index));
    await client.exec(`INSERT INTO users (id) VALUES ('existing')`);
    await migrateUp(client, migrations.slice(0, index + 1));
    await client.exec(`INSERT INTO users (id) VALUES ('new')`);
    expect(
      (
        await client.query(
          `SELECT id, staples_setup_state, staples_reminder_dismissed FROM users ORDER BY id`,
        )
      ).rows,
    ).toEqual([
      { id: "existing", staples_setup_state: "skipped", staples_reminder_dismissed: false },
      { id: "new", staples_setup_state: "incomplete", staples_reminder_dismissed: false },
    ]);
  });

  it("rolls down without removing the owner and can apply again", async () => {
    await migrateUp(client, migrations.slice(0, index + 1));
    await client.exec(`INSERT INTO users (id) VALUES ('owner-a')`);
    expect(await migrateDown(client, migrations.slice(0, index + 1), 1)).toEqual([
      "0010_staples_setup",
    ]);
    expect((await client.query(`SELECT id FROM users`)).rows).toEqual([{ id: "owner-a" }]);
    await migrateUp(client, migrations.slice(0, index + 1));
    expect((await client.query(`SELECT staples_setup_state FROM users`)).rows).toEqual([
      { staples_setup_state: "skipped" },
    ]);
  });
});
