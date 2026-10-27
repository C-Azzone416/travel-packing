import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { Db } from "@/server/db/retention";
import { createFakeAuth, makeContext, OWNER, signedInAs } from "@/server/data/__fixtures__/seed";

const lock = vi.hoisted(() => vi.fn());
const setupLock = vi.hoisted(() => vi.fn());

vi.mock("./account-deletion-lock", () => ({
  lockAccountDeletion: lock,
  lockAccountSetup: setupLock,
}));

import { beginAccountDeletion, completeAccountDeletion } from "./account-deletion";
import { createDbSetupStore } from "./account-setup";
import { run, setDataRateLimiter } from "@/server/data/run";

beforeEach(() => {
  lock.mockReset();
  setupLock.mockReset();
});
afterEach(() => setDataRateLimiter());

describe("account-deletion advisory-lock contract", () => {
  it("holds the setup lock across provider reset success and the setup-row write", async () => {
    const calls: string[] = [];
    const transaction = {
      execute: async () => {},
      insert: () => ({
        values: () => ({
          onConflictDoNothing: async () => calls.push("insert:setup"),
        }),
      }),
    };
    const db = {
      transaction: async (work: (tx: typeof transaction) => Promise<unknown>) => work(transaction),
    } as unknown as Db;
    setupLock.mockImplementation(async () => calls.push("lock:setup"));

    await createDbSetupStore(db, "synthetic-key").resetPasswordAndMarkComplete(
      "owner@example.test",
      async () => {
        calls.push("provider:reset");
        return { ok: true };
      },
    );

    expect(calls).toEqual(["lock:setup", "provider:reset", "insert:setup"]);
  });

  it("takes the owner lock in the deletion transaction before inserting the fence or deleting data", async () => {
    const calls: string[] = [];
    let deleteCount = 0;
    const transaction = {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => {
              calls.push("select:fence");
              return [
                {
                  identityCreatedAt: new Date(1_700_000_000_000),
                  setupEmailDigest: "a".repeat(64),
                },
              ];
            },
          }),
        }),
      }),
      insert: () => ({
        values: () => ({
          onConflictDoNothing: async () => {
            calls.push("insert:fence");
          },
        }),
      }),
      delete: () => ({
        where: async () => {
          deleteCount += 1;
          calls.push(deleteCount === 1 ? "delete:setup" : "delete:owner");
        },
      }),
    };
    const db = {
      transaction: async (work: (tx: typeof transaction) => Promise<void>) => work(transaction),
    } as unknown as Db;
    lock.mockImplementation(async (_tx, userId) => {
      calls.push(`lock:${userId}`);
    });
    setupLock.mockImplementation(async () => calls.push("lock:setup"));

    await beginAccountDeletion(db, OWNER.userId, 1_700_000_000_000, "a".repeat(64));

    expect(calls).toEqual([
      `lock:${OWNER.userId}`,
      "lock:setup",
      "insert:fence",
      "select:fence",
      "delete:setup",
      "delete:owner",
    ]);
    expect(lock).toHaveBeenCalledOnce();
    expect(lock).toHaveBeenCalledWith(transaction, OWNER.userId);
  });

  it("takes the same owner lock before the fresh fence read and provisioning insert", async () => {
    const calls: string[] = [];
    let selectCount = 0;
    const transaction = {
      select: () => {
        selectCount += 1;
        const operation = selectCount === 1 ? "select:fence" : "select:owner";
        return {
          from: () => ({
            where: () => ({
              limit: async () => {
                calls.push(operation);
                return operation === "select:fence" ? [] : [{ id: OWNER.userId }];
              },
            }),
          }),
        };
      },
      insert: () => ({
        values: () => ({
          onConflictDoNothing: async () => {
            calls.push("insert:owner");
          },
        }),
      }),
    };
    const db = {
      transaction: async (work: (tx: typeof transaction) => Promise<boolean>) => work(transaction),
    } as unknown as Db;
    const fake = createFakeAuth();
    signedInAs(fake, OWNER);
    lock.mockImplementation(async (_tx, userId) => {
      calls.push(`lock:${userId}`);
    });

    const result = await run(
      makeContext(db, fake),
      z.object({ value: z.string() }),
      { value: "x" },
      async () => "ran",
    );

    expect(result).toEqual({ ok: true, data: "ran" });
    expect(calls).toEqual([`lock:${OWNER.userId}`, "select:fence", "insert:owner", "select:owner"]);
    expect(lock).toHaveBeenCalledOnce();
    expect(lock).toHaveBeenCalledWith(transaction, OWNER.userId);
  });

  it("takes the same owner lock before terminal fence inspection, owner sweep, and fence removal", async () => {
    const calls: string[] = [];
    let deleteCount = 0;
    const transaction = {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => {
              calls.push("select:fence");
              return [
                {
                  identityCreatedAt: new Date(1_700_000_000_000),
                  setupEmailDigest: "a".repeat(64),
                },
              ];
            },
          }),
        }),
      }),
      delete: () => ({
        where: async () => {
          deleteCount += 1;
          calls.push(
            deleteCount === 1
              ? "delete:setup"
              : deleteCount === 2
                ? "delete:owner"
                : "delete:fence",
          );
        },
      }),
    };
    const db = {
      transaction: async (work: (tx: typeof transaction) => Promise<void>) => work(transaction),
    } as unknown as Db;
    lock.mockImplementation(async (_tx, userId) => {
      calls.push(`lock:${userId}`);
    });
    setupLock.mockImplementation(async () => calls.push("lock:setup"));

    await completeAccountDeletion(db, OWNER.userId, 1_700_000_000_000, "a".repeat(64));

    expect(calls).toEqual([
      `lock:${OWNER.userId}`,
      "lock:setup",
      "select:fence",
      "delete:setup",
      "delete:owner",
      "delete:fence",
    ]);
    expect(lock).toHaveBeenCalledOnce();
    expect(lock).toHaveBeenCalledWith(transaction, OWNER.userId);
  });
});
