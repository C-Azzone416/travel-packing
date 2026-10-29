// A fenced owner (account deletion in progress, #311) cannot write Framebriar enrollment state. Real PGlite database, the fake
// Framebriar service, synthetic ids only. Lock contention and ordering are in enrollment-fence.contract.test.ts.

import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createMigratedDb, resetData } from "../db/__fixtures__/db";
import type { Db } from "../db/retention";
import * as schema from "../db/schema";
import { createFakeService, type FakeService } from "./__fixtures__/fake-service";
import {
  AccountClosingError,
  accountGeneration,
  beginRedemption,
  commitRedemption,
  updateEnrollment,
} from "./enrollment-store";
import { createEnrollmentService, type EnrollmentService } from "./enrollment-service";
import { createFramebriarClient } from "./framebriar-client";
import { parseKeyRing, type KeyRing } from "./key-ring";

let ctx: Awaited<ReturnType<typeof createMigratedDb>>;
const db = () => ctx.db as unknown as Db;
const keyText = () => randomBytes(32).toString("base64");
const ringOf = (current: string, keys: Record<string, string>) =>
  parseKeyRing(JSON.stringify({ current, keys }))!;

const clock = Date.parse("2026-10-26T12:00:00Z");
const now = () => clock;
let fake: FakeService;
let ring: KeyRing;
const K1 = keyText();
const A = "owner-a";
const B = "owner-b";
const RING_LABEL = "k1";
const SEALED = "v1.synthetic";
const GENERATION = "11111111-1111-4111-8111-111111111111";
const ATTEMPT = "22222222-2222-4222-8222-222222222222";

function service(keys: () => KeyRing = () => ring): EnrollmentService {
  return createEnrollmentService({
    db: db(),
    client: createFramebriarClient({ fetchImpl: fake.fetch, now }),
    keys,
    now,
  });
}

const fence = (owner: string) =>
  db()
    .insert(schema.accountDeletions)
    .values({
      userId: owner,
      identityCreatedAt: new Date(1_700_000_000_000),
      setupEmailDigest: "a".repeat(64),
    });
const enrollments = () => db().select().from(schema.framebriarEnrollments);
const redemptions = () => db().select().from(schema.framebriarRedemptions);
const owners = () => db().select().from(schema.users);
const nothingWritten = async () => {
  expect(await owners()).toHaveLength(0);
  expect(await enrollments()).toHaveLength(0);
  expect(await redemptions()).toHaveLength(0);
};

beforeAll(async () => {
  ctx = await createMigratedDb();
});
beforeEach(async () => {
  await resetData(ctx.client);
  await ctx.client.exec('TRUNCATE TABLE "account_deletions"');
  fake = createFakeService(now);
  ring = ringOf("k1", { k1: K1 });
});
afterAll(async () => {
  await ctx.client.close();
});

async function connect(svc: EnrollmentService, owner: string) {
  const result = await svc.redeem(owner, fake.issueInvitation());
  expect(result).toMatchObject({ ok: true, status: "connected" });
}

describe("a fenced owner cannot write enrollment state", () => {
  it("refuses to redeem, creates no owner row, attempt or enrollment, and never calls Framebriar", async () => {
    await fence(A);
    expect(await service().redeem(A, fake.issueInvitation())).toEqual({
      ok: false,
      code: "ACCOUNT_CLOSING",
    });
    expect(fake.count("redeem")).toBe(0);
    await nothingWritten();
  });

  it("refuses to redeem even when a stale owner row is still there, and leaves no attempt", async () => {
    await db().insert(schema.users).values({ id: A });
    await fence(A);
    expect(await service().redeem(A, fake.issueInvitation())).toEqual({
      ok: false,
      code: "ACCOUNT_CLOSING",
    });
    expect(fake.count("redeem")).toBe(0);
    expect(await enrollments()).toHaveLength(0);
    expect(await redemptions()).toHaveLength(0);
  });

  it("refuses a refresh that would write a re-sealed credential, and leaves the row untouched", async () => {
    await connect(service(), A);
    const [before] = await enrollments();
    await fence(A);
    const rotated = ringOf("k2", { k1: K1, k2: keyText() });
    expect(await service(() => rotated).accessToken(A)).toEqual({
      ok: false,
      code: "ACCOUNT_CLOSING",
    });
    expect(fake.count("refresh")).toBe(0);
    expect((await enrollments())[0]).toEqual(before);
  });

  it("refuses a forced refresh and leaves the row untouched", async () => {
    await connect(service(), A);
    const [before] = await enrollments();
    await fence(A);
    expect(await service().accessToken(A, true)).toEqual({ ok: false, code: "ACCOUNT_CLOSING" });
    expect(fake.count("refresh")).toBe(0);
    expect((await enrollments())[0]).toEqual(before);
  });

  it("refuses to mark an upload as ended", async () => {
    await connect(service(), A);
    const [before] = await enrollments();
    await fence(A);
    await service().markEnded(A, "revoked");
    expect((await enrollments())[0]).toEqual(before);
  });

  it("reads as unavailable and creates no owner row on status or disconnect", async () => {
    await fence(A);
    expect(await service().status(A)).toMatchObject({ status: "unavailable", outboxKey: null });
    expect(await service().disconnect(A)).toEqual({ ok: false, code: "UNAVAILABLE" });
    await nothingWritten();
  });

  it("does not affect another account, and the owner can connect again once the fence is gone", async () => {
    await fence(A);
    const svc = service();
    await connect(svc, B);
    expect(await svc.redeem(A, fake.issueInvitation())).toMatchObject({ ok: false });
    await db().delete(schema.accountDeletions);
    await connect(svc, A);
    expect((await svc.status(A)).status).toBe("connected");
  });
});

describe("the enrollment store refuses a fenced owner with a typed error", () => {
  it.each([
    ["accountGeneration", () => accountGeneration(db(), A)],
    ["beginRedemption", () => beginRedemption(db(), A, GENERATION, new Date(now()), () => ATTEMPT)],
    [
      "commitRedemption",
      () =>
        commitRedemption(db(), {
          ownerId: A,
          generation: GENERATION,
          attemptId: ATTEMPT,
          keyVersion: RING_LABEL,
          credentials: SEALED,
          expiresAt: new Date(now() + 1000),
          expectedRevision: null,
        }),
    ],
    [
      "updateEnrollment",
      () =>
        updateEnrollment(
          db(),
          {
            ownerId: A,
            generation: GENERATION,
            keyVersion: RING_LABEL,
            credentials: SEALED,
            expiresAt: new Date(now() + 1000),
            state: "active",
            revision: 0,
          },
          { state: "revoked" },
        ),
    ],
  ])("%s throws AccountClosingError and writes nothing", async (_name, call) => {
    await fence(A);
    await expect(call()).rejects.toBeInstanceOf(AccountClosingError);
    await nothingWritten();
  });

  it("still serves an unfenced owner while someone else is fenced", async () => {
    await fence(B);
    const generation = await accountGeneration(db(), A);
    expect(generation).toMatch(/^[0-9a-f-]{36}$/);
    expect(await beginRedemption(db(), A, generation, new Date(now()), () => ATTEMPT)).toBe(
      ATTEMPT,
    );
  });
});
