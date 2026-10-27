import { describe, expect, it, vi } from "vitest";
import { createMemoryIdb } from "@/test/fake-feedback-server";
import {
  ACCOUNT_DB_PREFIX,
  accountDatabaseName,
  accountScope,
  deleteAccountOutbox,
  deleteLegacyDatabases,
  sweepOtherAccounts,
} from "./account-scope";

const A = "A".repeat(43);
const B = "B".repeat(43);

describe("accountScope", () => {
  it("names the queue from the opaque key only", () => {
    expect(accountScope(A)).toBe(`acct-${A}`);
    expect(accountDatabaseName(A)).toBe(`${ACCOUNT_DB_PREFIX}${A}`);
    expect(accountDatabaseName(A)).toBe(`framebriar-v1-acct-${A}`);
  });

  it.each([
    "",
    "short",
    "has space ".padEnd(20, "x"),
    "../../etc/passwd".padEnd(20, "x"),
    "a".repeat(65),
    "é".repeat(20),
    "x/y".padEnd(20, "z"),
  ])("refuses %j, so a database name can never be forged from it", (key) => {
    expect(() => accountScope(key)).toThrow();
  });
});

describe("sweepOtherAccounts (an account switch)", () => {
  it("deletes every account's outbox except the current one, and nothing else", async () => {
    const idb = createMemoryIdb([
      accountDatabaseName(A),
      accountDatabaseName(B),
      "app-own-db",
      "framebriar-v1-outbox-v2-legacy",
    ]);
    const sweep = await sweepOtherAccounts(idb.factory, A);
    expect(sweep).toEqual({ listed: true, deleted: 1, failed: 0 });
    expect(idb.deleted).toEqual([accountDatabaseName(B)]);
    expect([...idb.present].sort()).toEqual(
      [accountDatabaseName(A), "app-own-db", "framebriar-v1-outbox-v2-legacy"].sort(),
    );
  });

  it("does nothing when there is no other account", async () => {
    const idb = createMemoryIdb([accountDatabaseName(A)]);
    expect(await sweepOtherAccounts(idb.factory, A)).toEqual({
      listed: true,
      deleted: 0,
      failed: 0,
    });
  });

  it("says it could not look when the browser cannot list its databases (the scope still holds; only the sweep is skipped)", async () => {
    const factory = { deleteDatabase: vi.fn() } as unknown as IDBFactory;
    expect(await sweepOtherAccounts(factory, A)).toEqual({ listed: false, deleted: 0, failed: 0 });
    expect(factory.deleteDatabase).not.toHaveBeenCalled();
  });

  it("survives a listing that throws", async () => {
    const factory = {
      databases: async () => Promise.reject(new Error("no")),
      deleteDatabase: vi.fn(),
    } as unknown as IDBFactory;
    expect(await sweepOtherAccounts(factory, A)).toEqual({ listed: false, deleted: 0, failed: 0 });
  });

  it("counts a database it could not delete, and a delete that throws or errors, as failed", async () => {
    const factory = {
      databases: async () => [
        { name: accountDatabaseName(B) },
        { name: accountDatabaseName("C".repeat(43)) },
        { name: accountDatabaseName("D".repeat(43)) },
      ],
      deleteDatabase: vi
        .fn()
        .mockImplementationOnce(() => {
          throw new Error("denied");
        })
        .mockImplementationOnce(() => {
          const request: { onerror: (() => void) | null } = { onerror: null };
          queueMicrotask(() => request.onerror?.());
          return request;
        })
        .mockImplementationOnce(() => {
          const request: { onsuccess: (() => void) | null } = { onsuccess: null };
          queueMicrotask(() => request.onsuccess?.());
          return request;
        }),
    } as unknown as IDBFactory;
    expect(await sweepOtherAccounts(factory, A)).toEqual({ listed: true, deleted: 1, failed: 2 });
  });

  it("gives up on a database another tab holds open instead of waiting forever", async () => {
    vi.useFakeTimers();
    try {
      const idb = createMemoryIdb([accountDatabaseName(B)]);
      idb.blocked.add(accountDatabaseName(B));
      const pending = sweepOtherAccounts(idb.factory, A);
      await vi.advanceTimersByTimeAsync(3100);
      expect(await pending).toEqual({ listed: true, deleted: 0, failed: 1 });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("deleteAccountOutbox (sign-out)", () => {
  it("deletes this account's own database", async () => {
    const idb = createMemoryIdb([accountDatabaseName(A), accountDatabaseName(B)]);
    expect(await deleteAccountOutbox(idb.factory, A)).toBe(true);
    expect([...idb.present]).toEqual([accountDatabaseName(B)]);
  });

  it("refuses a key that is not the server's", async () => {
    const idb = createMemoryIdb(["x"]);
    await expect(deleteAccountOutbox(idb.factory, "nope")).rejects.toThrow();
  });
});

describe("deleteLegacyDatabases (the #137 browser enrollment and owner-less outbox)", () => {
  it("deletes the enrollment (v1 and v2) and the endpoint-named outboxes, and leaves account databases and everything else", async () => {
    const endpoint = encodeURIComponent("https://feedback.example.test");
    const idb = createMemoryIdb([
      `framebriar-enrollment-v2-${endpoint}-travel-packing`,
      `framebriar-enrollment-v1-${endpoint}-travel-packing-abcdef1`,
      `framebriar-v1-outbox-v2-${endpoint}-travel-packing`,
      `framebriar-v1-outbox-${endpoint}-travel-packing-abcdef1`,
      accountDatabaseName(A),
      "unrelated",
    ]);
    const sweep = await deleteLegacyDatabases(idb.factory);
    expect(sweep).toEqual({ listed: true, deleted: 4, failed: 0 });
    expect([...idb.present].sort()).toEqual([accountDatabaseName(A), "unrelated"].sort());
  });

  it("does nothing the second time", async () => {
    const idb = createMemoryIdb(["framebriar-enrollment-v2-x"]);
    await deleteLegacyDatabases(idb.factory);
    expect(await deleteLegacyDatabases(idb.factory)).toEqual({
      listed: true,
      deleted: 0,
      failed: 0,
    });
  });
});
