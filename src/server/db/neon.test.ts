import { beforeEach, describe, expect, it, vi } from "vitest";

const poolCalls: unknown[] = [];
const clientEvents: string[] = [];
const queryResults: { rows: unknown[] }[] = [];
const drizzleCalls: { client: unknown; config: unknown }[] = [];

vi.mock("@neondatabase/serverless", () => ({
  Pool: class {
    constructor(config: unknown) {
      poolCalls.push(config);
    }
  },
  Client: class {
    constructor(readonly config: unknown) {
      clientEvents.push(`new:${JSON.stringify(config)}`);
    }
    async connect() {
      clientEvents.push("connect");
    }
    async query(sql: string, params?: unknown[]) {
      clientEvents.push(`query:${sql}:${JSON.stringify(params ?? null)}`);
      return queryResults.shift() ?? { rows: [] };
    }
    async end() {
      clientEvents.push("end");
    }
  },
}));
vi.mock("drizzle-orm/neon-serverless", () => ({
  drizzle: (client: unknown, config: unknown) => {
    drizzleCalls.push({ client, config });
    return { fake: "db" };
  },
}));

import { assertUnpooled, createAppDb, createMigrationConnection } from "./neon";
import * as schema from "./schema";

const DIRECT = "postgres://user:pw@ep-quiet-leaf-123.us-west-2.aws.neon.tech/db";
const POOLED = "postgres://user:pw@ep-quiet-leaf-123-pooler.us-west-2.aws.neon.tech/db";

beforeEach(() => {
  poolCalls.length = 0;
  clientEvents.length = 0;
  queryResults.length = 0;
  drizzleCalls.length = 0;
});

describe("createAppDb", () => {
  it("wraps a pooled Neon driver in Drizzle with the schema, using the given connection string", () => {
    const db = createAppDb(DIRECT);
    expect(db).toEqual({ fake: "db" });
    expect(poolCalls).toEqual([{ connectionString: DIRECT }]);
    expect(drizzleCalls[0].config).toEqual({ schema });
  });
});

describe("assertUnpooled", () => {
  it("accepts a direct host", () => {
    expect(() => assertUnpooled(DIRECT)).not.toThrow();
  });

  it("rejects a pooled host and a malformed URL without echoing the value", () => {
    expect(() => assertUnpooled(POOLED)).toThrow("must be a direct (non-pooled) connection");
    let message = "";
    try {
      assertUnpooled("not a url with secret-token");
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toBe("DATABASE_URL_UNPOOLED is not a valid connection URL");
    expect(message).not.toContain("secret-token");
  });
});

describe("createMigrationConnection", () => {
  it("refuses a pooled URL before opening anything", () => {
    expect(() => createMigrationConnection(POOLED)).toThrow();
    expect(clientEvents).toEqual([]);
  });

  it("opens one connection lazily and reuses it", async () => {
    const connection = createMigrationConnection(DIRECT);
    expect(clientEvents).toEqual([`new:${JSON.stringify({ connectionString: DIRECT })}`]);
    await connection.exec("SELECT 1");
    queryResults.push({ rows: [{ tag: "0000_init" }] });
    const result = await connection.query<{ tag: string }>("SELECT tag FROM t WHERE x = $1", ["a"]);
    expect(result).toEqual({ rows: [{ tag: "0000_init" }] });
    expect(clientEvents.filter((event) => event === "connect")).toHaveLength(1);
    expect(clientEvents).toContain('query:SELECT tag FROM t WHERE x = $1:["a"]');
  });

  it("closes the connection only if it was opened", async () => {
    const unused = createMigrationConnection(DIRECT);
    await unused.close();
    expect(clientEvents).not.toContain("end");
    const used = createMigrationConnection(DIRECT);
    await used.exec("SELECT 1");
    await used.close();
    expect(clientEvents).toContain("end");
  });
});
