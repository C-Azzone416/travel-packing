// Migration 0011 (#259): every account gets a non-reusable generation, and the Framebriar enrollment tables can only reference the
// generation that made them.

import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { MIGRATIONS_DIR } from "./__fixtures__/db";
import { loadMigrations, migrateDown, migrateUp } from "./migrator";

const client = new PGlite();
const migrations = loadMigrations(MIGRATIONS_DIR);
const index = migrations.findIndex((migration) => migration.tag === "0011_framebriar_enrollment");

beforeEach(async () => {
  await client.exec("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
});
afterAll(async () => client.close());

describe("0011_framebriar_enrollment", () => {
  it("follows the staples setup migration", () => {
    expect(index).toBeGreaterThan(0);
    expect(migrations[index - 1].tag).toBe("0010_staples_setup");
  });

  it("gives every existing account its own generation, and a new one to a recreated account", async () => {
    await migrateUp(client, migrations.slice(0, index));
    await client.exec(`INSERT INTO users (id) VALUES ('a'), ('b')`);
    await migrateUp(client, migrations.slice(0, index + 1));
    const generations = (
      await client.query<{ id: string; generation: string }>(`SELECT id, generation FROM users`)
    ).rows;
    expect(new Set(generations.map((row) => row.generation)).size).toBe(2);
    const [{ generation: first }] = (
      await client.query<{ generation: string }>(`SELECT generation FROM users WHERE id = 'a'`)
    ).rows;
    await client.exec(`DELETE FROM users WHERE id = 'a'; INSERT INTO users (id) VALUES ('a')`);
    const [{ generation: second }] = (
      await client.query<{ generation: string }>(`SELECT generation FROM users WHERE id = 'a'`)
    ).rows;
    expect(second).not.toBe(first);
  });

  it("enrollment rows exist only for the generation that made them, and go with the account", async () => {
    await migrateUp(client, migrations.slice(0, index + 1));
    await client.exec(`INSERT INTO users (id) VALUES ('a')`);
    const [{ generation }] = (
      await client.query<{ generation: string }>(`SELECT generation FROM users`)
    ).rows;
    const insert = (generationValue: string) =>
      client.exec(
        `INSERT INTO framebriar_enrollments (owner_id, generation, key_version, credentials, expires_at) VALUES ('a', '${generationValue}', 'k1', 'v1.x', now())`,
      );
    await expect(insert("00000000-0000-4000-8000-000000000000")).rejects.toThrow();
    await insert(generation);
    await client.exec(
      `INSERT INTO framebriar_redemptions (owner_id, generation, attempt_id) VALUES ('a', '${generation}', gen_random_uuid())`,
    );
    await expect(
      client.exec(`UPDATE framebriar_enrollments SET state = 'unknown'`),
    ).rejects.toThrow();
    await client.exec(`DELETE FROM users WHERE id = 'a'`);
    expect((await client.query(`SELECT 1 FROM framebriar_enrollments`)).rows).toEqual([]);
    expect((await client.query(`SELECT 1 FROM framebriar_redemptions`)).rows).toEqual([]);
  });

  it("rolls down without removing accounts and can apply again", async () => {
    await migrateUp(client, migrations.slice(0, index + 1));
    await client.exec(`INSERT INTO users (id) VALUES ('owner-a')`);
    expect(await migrateDown(client, migrations.slice(0, index + 1), 1)).toEqual([
      "0011_framebriar_enrollment",
    ]);
    expect((await client.query(`SELECT id FROM users`)).rows).toEqual([{ id: "owner-a" }]);
    await migrateUp(client, migrations.slice(0, index + 1));
    expect((await client.query(`SELECT generation FROM users`)).rows).toHaveLength(1);
  });
});
