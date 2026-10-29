// Lock contract for the enrollment writes (#311), in the style of account-deletion-lock.contract.test.ts. PGlite has one connection,
// so real lock contention is modelled here: a fake database whose transactions hold first-in-first-out mutexes (one per advisory
// lock and one for the owner-row lock) until they finish, with the fence committed only when the deletion transaction commits.

import { beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "../db/schema";
import type { Db } from "../db/retention";

const lockOwner = vi.hoisted(() => vi.fn());
const lockSetup = vi.hoisted(() => vi.fn());

vi.mock("../auth/account-deletion-lock", () => ({
  lockAccountDeletion: lockOwner,
  lockAccountSetup: lockSetup,
}));
// The deletion transaction's feedback gate reads real tables; the world below holds none.
vi.mock("./enrollment-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./enrollment-store")>()),
  accountHoldsFeedback: async () => false,
}));

import { beginAccountDeletion } from "../auth/account-deletion";
import {
  AccountClosingError,
  accountGeneration,
  beginRedemption,
  commitRedemption,
  updateEnrollment,
} from "./enrollment-store";

const OWNER = "owner-a";
const DIGEST = "d".repeat(64);
const CREATED = 1_700_000_000_000;
const RING_LABEL = "k1";
const SEALED = "v1.synthetic";
const GENERATION = "11111111-1111-4111-8111-111111111111";

interface Deferred {
  promise: Promise<void>;
  resolve: () => void;
}
const deferred = (): Deferred => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => (resolve = done));
  return { promise, resolve };
};

class World {
  fenceCommitted = false;
  events: string[] = [];
  private tails = new Map<string, Promise<void>>();
  /** A transaction stops here (holding every lock it has taken) until the test resumes it. */
  pause: { at: string; reached: Deferred; resume: Deferred } | null = null;

  async acquire(tx: Tx, key: string) {
    const previous = this.tails.get(key) ?? Promise.resolve();
    const mine = deferred();
    this.tails.set(
      key,
      previous.then(() => mine.promise),
    );
    await previous;
    tx.releases.push(mine.resolve);
    tx.world.events.push(`${tx.name}:lock:${key}`);
  }

  async maybePause(tx: Tx, at: string) {
    this.events.push(`${tx.name}:${at}`);
    if (this.pause?.at === at) {
      this.pause.reached.resolve();
      await this.pause.resume.promise;
    }
  }

  db(name: string): Db {
    return {
      transaction: async (work: (tx: Tx) => Promise<unknown>) => {
        const tx = new Tx(this, name);
        try {
          const result = await work(tx);
          if (tx.ownFence) this.fenceCommitted = true;
          this.events.push(`${name}:commit`);
          return result;
        } finally {
          for (const release of tx.releases) release();
        }
      },
    } as unknown as Db;
  }
}

class Tx {
  releases: Array<() => void> = [];
  ownFence = false;
  constructor(
    readonly world: World,
    readonly name: string,
  ) {}

  select() {
    let from: unknown;
    const rows = () => {
      if (from === schema.accountDeletions)
        return this.ownFence || this.world.fenceCommitted
          ? [
              {
                userId: OWNER,
                identityCreatedAt: new Date(CREATED),
                setupEmailDigest: DIGEST,
              },
            ]
          : [];
      return from === schema.users ? [{ id: OWNER, generation: GENERATION }] : [];
    };
    const query = {
      from: (table: unknown) => {
        from = table;
        this.world.events.push(`${this.name}:select`);
        return query;
      },
      where: () => query,
      limit: () => query,
      for: async () => {
        await this.world.acquire(this, "row");
        await this.world.maybePause(this, "row-locked");
        return rows();
      },
      then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
        Promise.resolve(rows()).then(resolve, reject),
    };
    return query;
  }

  insert(table: unknown) {
    const write = async () => {
      if (table === schema.accountDeletions) this.ownFence = true;
      else if (table === schema.users) await this.world.maybePause(this, "provision-owner");
      this.world.events.push(`${this.name}:insert`);
    };
    return {
      values: () => ({
        onConflictDoNothing: () => ({
          then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
            write().then(resolve, reject),
          returning: async () => {
            await write();
            return [{ ownerId: OWNER }];
          },
        }),
        onConflictDoUpdate: write,
      }),
    };
  }

  update() {
    return {
      set: () => ({
        where: () => ({
          returning: async () => {
            this.world.events.push(`${this.name}:update`);
            return [{ revision: 1, ownerId: OWNER }];
          },
        }),
      }),
    };
  }

  delete() {
    return { where: async () => this.world.events.push(`${this.name}:delete`) };
  }

  async execute() {}
}

let world: World;
beforeEach(() => {
  world = new World();
  lockOwner.mockReset();
  lockSetup.mockReset();
  lockOwner.mockImplementation(async (tx: Tx) => world.acquire(tx, "owner"));
  lockSetup.mockImplementation(async (tx: Tx) => world.acquire(tx, "setup"));
});

const row = {
  ownerId: OWNER,
  generation: GENERATION,
  keyVersion: RING_LABEL,
  credentials: SEALED,
  expiresAt: new Date(CREATED + 1000),
  state: "active" as const,
  revision: 0,
};
const writes: Array<[string, (db: Db) => Promise<unknown>, string]> = [
  ["accountGeneration", (db) => accountGeneration(db, OWNER), "insert"],
  [
    "beginRedemption",
    (db) => beginRedemption(db, OWNER, GENERATION, new Date(CREATED), () => "attempt-1"),
    "insert",
  ],
  [
    "commitRedemption",
    (db) =>
      commitRedemption(db, {
        ownerId: OWNER,
        generation: GENERATION,
        attemptId: "attempt-1",
        keyVersion: RING_LABEL,
        credentials: SEALED,
        expiresAt: new Date(CREATED + 1000),
        expectedRevision: null,
      }),
    "insert",
  ],
  ["updateEnrollment", (db) => updateEnrollment(db, row, { state: "revoked" }), "update"],
];

describe("every enrollment write takes the owner lock first, then checks the fence, then writes", () => {
  it.each(writes)("%s", async (_name, call, firstWrite) => {
    await call(world.db("enroll"));
    expect(lockOwner).toHaveBeenCalledOnce();
    expect(lockSetup).not.toHaveBeenCalled();
    const events = world.events.filter((event) => !event.endsWith(":commit"));
    expect(events[0]).toBe("enroll:lock:owner");
    expect(events[1]).toBe("enroll:select"); // the fence read
    expect(events.indexOf(`enroll:${firstWrite}`)).toBeGreaterThan(1);
  });

  it.each(writes)("%s refuses once the fence is committed, before writing", async (_name, call) => {
    world.fenceCommitted = true;
    await expect(call(world.db("enroll"))).rejects.toBeInstanceOf(AccountClosingError);
    expect(world.events.filter((event) => /:(insert|update|delete)$/.test(event))).toEqual([]);
  });
});

describe("enrollment and beginAccountDeletion contend on the same lock and neither order deadlocks", () => {
  const settle = async <T>(work: Promise<T>) =>
    Promise.race([
      work,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("deadlock: did not finish")), 2000),
      ),
    ]);

  it("deletion first: an enrollment write that arrives while the fence is being built waits, then is refused", async () => {
    world.pause = { at: "row-locked", reached: deferred(), resume: deferred() };
    const deletion = beginAccountDeletion(world.db("delete"), OWNER, CREATED, DIGEST);
    await world.pause.reached.promise;
    const enrollment = accountGeneration(world.db("enroll"), OWNER).then(
      () => "wrote",
      (error: unknown) => (error instanceof AccountClosingError ? "refused" : "failed"),
    );
    // It is queued behind the deletion's owner lock: it has not even read the fence yet.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(world.events).not.toContain("enroll:select");
    world.pause.resume.resolve();

    expect(await settle(deletion)).toBe("started");
    expect(await settle(enrollment)).toBe("refused");
    expect(
      world.events.filter((event) => event.startsWith("enroll:") && /insert/.test(event)),
    ).toEqual([]);
    expect(world.events.indexOf("delete:commit")).toBeLessThan(
      world.events.indexOf("enroll:select"),
    );
  });

  it("enrollment first: a deletion that arrives while a write is in flight waits for it, then runs", async () => {
    world.pause = { at: "provision-owner", reached: deferred(), resume: deferred() };
    const enrollment = accountGeneration(world.db("enroll"), OWNER).then(
      () => "wrote",
      () => "refused",
    );
    await world.pause.reached.promise;
    const deletion = beginAccountDeletion(world.db("delete"), OWNER, CREATED, DIGEST);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(world.events).not.toContain("delete:select");
    world.pause.resume.resolve();

    expect(await settle(enrollment)).toBe("wrote");
    expect(await settle(deletion)).toBe("started");
    expect(world.events.indexOf("enroll:commit")).toBeLessThan(
      world.events.indexOf("delete:select"),
    );
  });

  it("many writers of every kind and one deletion all finish, in either start order", async () => {
    for (const deletionFirst of [true, false]) {
      world = new World();
      lockOwner.mockImplementation(async (tx: Tx) => world.acquire(tx, "owner"));
      lockSetup.mockImplementation(async (tx: Tx) => world.acquire(tx, "setup"));
      const enrollment = () =>
        writes.map(([, call], index) =>
          call(world.db(`enroll${index}`)).then(
            () => "wrote",
            (error: unknown) => (error instanceof AccountClosingError ? "refused" : "failed"),
          ),
        );
      const deletion = () => beginAccountDeletion(world.db("delete"), OWNER, CREATED, DIGEST);
      const results = await settle(
        Promise.all(deletionFirst ? [deletion(), ...enrollment()] : [...enrollment(), deletion()]),
      );
      expect(results).toContain("started");
      expect(results).not.toContain("failed");
    }
  });

  it("takes the owner lock before the deletion's setup and row locks, which is the order enrollment is a prefix of", async () => {
    await beginAccountDeletion(world.db("delete"), OWNER, CREATED, DIGEST);
    const order = world.events.filter((event) => event.includes(":lock:"));
    expect(order).toEqual(["delete:lock:owner", "delete:lock:setup", "delete:lock:row"]);
  });
});
