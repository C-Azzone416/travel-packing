import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  createFakeAuth,
  makeContext,
  OTHER_OWNER,
  OWNER,
  signedInAs,
} from "../data/__fixtures__/seed";
import * as service from "../data/service";
import { sampleTripId } from "../seed/sample-data";
import { closeE2eDb, createE2eDb, e2eDatabaseEnabled, E2E_DB_DRIVER_MARKER } from "./e2e-driver";
import { startE2eDbServer, type E2eDbServer } from "./e2e-db-server";
import type { Db } from "./retention";

let server: E2eDbServer;
const opened: Db[] = [];
const open = () => {
  const db = createE2eDb(server.url);
  opened.push(db);
  return db;
};

beforeAll(async () => {
  server = await startE2eDbServer({ port: 0, seedOwners: [OWNER.userId] });
});
// Each test opens its own single-connection pools; closing them keeps the server's connection count honest.
afterEach(async () => {
  for (const db of opened.splice(0)) await closeE2eDb(db);
});
afterAll(async () => {
  await server.stop();
});

const fake = createFakeAuth();
const as = (user: typeof OWNER | null) => signedInAs(fake, user);

describe("e2e database server (real Postgres wire protocol over PGlite)", () => {
  it("listens on a real port and hands out a postgres connection string", () => {
    expect(server.port).toBeGreaterThan(0);
    expect(server.url).toBe(`postgres://postgres:postgres@127.0.0.1:${server.port}/postgres`);
  });

  it("is migrated and seeded: the data layer reads the sample set through the real driver", async () => {
    as(OWNER);
    const result = await service.listTrips(makeContext(open(), fake));
    expect(result.ok && result.data.map((trip) => trip.destination).sort()).toEqual([
      "Lisbon",
      "San Diego",
    ]);
    expect(result.ok && result.data.map((trip) => trip.id)).toContain(
      sampleTripId(OWNER.userId, "lisbon"),
    );
  });

  it("writes through the data layer persist, including transactions, and survive a new connection pool", async () => {
    as(OWNER);
    const first = makeContext(open(), fake);
    const location = {
      id: "sample-x",
      city: "Exampleville",
      region: "Sample Region",
      country: "Sampleland",
      countryCode: "SL",
      label: "Exampleville, Sample Region, Sampleland",
    };
    const created = await service.createTrip(first, {
      location,
      start: "2030-05-01",
      end: "2030-05-05",
      config: {
        laundry: false,
        spare: false,
        niceAttire: false,
        occasionCount: 1,
        reuseNice: false,
        returnOutfit: true,
      },
    });
    if (!created.ok) throw new Error(created.error.code);
    const toggled = await service.togglePackedItem(first, {
      tripId: created.data.id,
      itemId: "sunglasses",
    });
    expect(toggled.ok).toBe(true);
    await service.removeTrip(first, { tripId: sampleTripId(OWNER.userId, "san-diego") });

    // A brand-new pool = a reload/reconnect.
    const second = makeContext(open(), fake);
    const reloaded = await service.getTrip(second, { tripId: created.data.id });
    expect(reloaded.ok && reloaded.data.destination).toBe("Exampleville");
    expect(
      reloaded.ok && reloaded.data.items.find((item) => item.id === "sunglasses")?.packed,
    ).toBe(1);
    const live = await service.listTrips(second);
    expect(live.ok && live.data.map((trip) => trip.destination)).not.toContain("San Diego");
    const deleted = await service.listRecentlyDeletedTrips(second);
    expect(deleted.ok && deleted.data.map((trip) => trip.destination)).toEqual(["San Diego"]);
  });

  it("another owner cannot see the first owner's data over the real driver", async () => {
    as(OTHER_OWNER);
    const context = makeContext(open(), fake);
    const result = await service.listTrips(context);
    expect(result.ok && result.data).toEqual([]);
    const theirs = await service.getTrip(context, { tripId: sampleTripId(OWNER.userId, "lisbon") });
    expect(theirs.ok).toBe(false);
    expect(!theirs.ok && theirs.error.code).toBe("NOT_FOUND");
  });

  it("handles concurrent requests (the app opens several connections)", async () => {
    as(OWNER);
    const context = makeContext(open(), fake);
    const results = await Promise.all(Array.from({ length: 12 }, () => service.listTrips(context)));
    expect(results.every((result) => result.ok)).toBe(true);
  });
});

describe("startE2eDbServer guard", () => {
  it("refuses to start in production or on Vercel (same guard as db:seed)", async () => {
    await expect(
      startE2eDbServer({ port: 0, seedOwners: [], env: { NODE_ENV: "production" } }),
    ).rejects.toThrow("refused");
    await expect(
      startE2eDbServer({ port: 0, seedOwners: [], env: { VERCEL: "1" } }),
    ).rejects.toThrow("refused");
  });
});

describe("e2e-driver", () => {
  it("needs an explicit URL and is never enabled on Vercel", () => {
    expect(e2eDatabaseEnabled({ E2E_DATABASE_URL: "postgres://x" })).toBe(true);
    expect(e2eDatabaseEnabled({})).toBe(false);
    expect(e2eDatabaseEnabled({ E2E_DATABASE_URL: "  " })).toBe(false);
    expect(e2eDatabaseEnabled({ E2E_DATABASE_URL: "postgres://x", VERCEL: "1" })).toBe(false);
  });

  it("carries a marker the build check can find", () => {
    expect(E2E_DB_DRIVER_MARKER).toBe("e2e-test-only-pg-driver");
  });
});
