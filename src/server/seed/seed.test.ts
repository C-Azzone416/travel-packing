import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_STAPLES } from "../../domain/calc";
import { allPacked } from "../../domain/readiness";
import { findIdentityViolations } from "../../domain/item-ops";
import { classifyTrip, type LifecycleTrip } from "../../domain/trip-lifecycle";
import { createMigratedDb, resetData } from "../db/__fixtures__/db";
import type { Db } from "../db/retention";
import { createFakeAuth, makeContext, signedInAs } from "../data/__fixtures__/seed";
import { listStaples } from "../data/staple-store";
import * as service from "../data/service";
import { loadTrips, type StoredTrip } from "../data/trip-store";
import {
  addDays,
  LISBON_STARTED_DAYS_AGO,
  SAMPLE_TODAY,
  SAN_DIEGO_STARTS_IN_DAYS,
  sampleTripId,
  sampleTrips,
} from "./sample-data";
import { seedSyntheticData } from "./seed";

let ctx: Awaited<ReturnType<typeof createMigratedDb>>;
const db = () => ctx.db as unknown as Db;

beforeAll(async () => {
  ctx = await createMigratedDb();
});
beforeEach(async () => {
  await resetData(ctx.client);
});
afterAll(async () => {
  await ctx.client.close();
});

const OWNER = "seed-owner";
const bySlug = async (ownerId: string, destination: string) => {
  const found = (await loadTrips(db(), ownerId, { filter: "live" })).find(
    (trip) => trip.destination === destination,
  ) as StoredTrip;
  return { ...found, updatedAt: undefined }; // a reseed saves the trip again: only the time differs
};

/** Everything about the seeded state except timestamps, in a stable order. */
async function state(ownerId: string) {
  const trips = (await loadTrips(db(), ownerId, { filter: "live" })).sort((a, b) =>
    a.id.localeCompare(b.id),
  );
  const staples = (
    await ctx.client.query(
      'SELECT semantic_id, name, category, qty, cadence, pack_last, group_id, version FROM "staples" WHERE owner_id = $1 ORDER BY semantic_id',
      [ownerId],
    )
  ).rows;
  const counts = (
    await ctx.client.query<{ trips: string; items: string; progress: string; staples: string }>(
      `SELECT (SELECT count(*) FROM trips)::text AS trips, (SELECT count(*) FROM trip_items)::text AS items,
              (SELECT count(*) FROM trip_item_progress)::text AS progress, (SELECT count(*) FROM staples)::text AS staples`,
    )
  ).rows[0];
  const withoutTimes = trips.map((trip) => ({ ...trip, updatedAt: undefined }));
  return JSON.stringify({ trips: withoutTimes, staples, counts });
}

describe("the sample set (plan §6)", () => {
  beforeEach(async () => {
    await seedSyntheticData(db(), OWNER, SAMPLE_TODAY);
  });

  it("seeds exactly two trips and the default staples", async () => {
    const trips = await loadTrips(db(), OWNER, { filter: "live" });
    expect(trips.map((trip) => trip.destination).sort()).toEqual(["Lisbon", "San Diego"]);
    const staples = await listStaples(db(), OWNER);
    expect(staples.map((staple) => staple.id).sort()).toEqual(
      DEFAULT_STAPLES.map((staple) => staple.id).sort(),
    );
    for (const staple of staples) {
      const expected = DEFAULT_STAPLES.find((entry) => entry.id === staple.id);
      expect(staple).toMatchObject({
        name: expected?.name,
        category: expected?.category,
        qty: expected?.qty,
        cadence: expected?.cadence,
        packLast: expected?.packLast,
      });
    }
  });

  it("San Diego: upcoming, partially packed, Nice outfits on, not Ready", async () => {
    const trip = await bySlug(OWNER, "San Diego");
    expect(trip).toMatchObject({
      locationId: "us-ca-san-diego",
      start: "2026-10-23",
      end: "2026-10-27",
      ready: false,
      toiletryBagPacked: false,
      archived: false,
      config: { niceAttire: true, occasionCount: 1, reuseNice: true, spare: true, laundry: false },
      weather: { status: "pending" },
    });
    expect(classifyTrip(trip as unknown as LifecycleTrip, SAMPLE_TODAY)).toBe("upcoming");
    expect(trip.items.some((item) => item.id.startsWith("nice-"))).toBe(true);
    const packed = trip.items.filter((item) => item.packed > 0);
    const unpacked = trip.items.filter((item) => item.packed < item.qty);
    expect(packed.length).toBeGreaterThan(0);
    expect(unpacked.length).toBeGreaterThan(0);
    expect(allPacked(trip)).toBe(false);
    expect(trip.items.find((item) => item.id === "underwear")?.packed).toBe(2);
  });

  it("Lisbon: past, fully packed, bag confirmed, Ready, umbrella accepted", async () => {
    const trip = await bySlug(OWNER, "Lisbon");
    expect(trip).toMatchObject({
      locationId: "pt-lisbon",
      start: "2026-09-03",
      end: "2026-09-07",
      ready: true,
      toiletryBagPacked: true,
      config: { laundry: true, spare: false },
      weather: { status: "accepted" },
    });
    expect(classifyTrip(trip as unknown as LifecycleTrip, SAMPLE_TODAY)).toBe("past");
    expect(trip.items.every((item) => item.packed === item.qty)).toBe(true);
    expect(allPacked(trip)).toBe(true);
    expect(trip.items.filter((item) => item.id === "weather-umbrella")).toHaveLength(1);
  });

  it("both trips obey the item identity rules", async () => {
    for (const trip of await loadTrips(db(), OWNER, { filter: "live" })) {
      expect(findIdentityViolations(trip)).toEqual([]);
    }
  });

  it("the data layer can read the seeded set as that owner", async () => {
    const fake = createFakeAuth();
    signedInAs(fake, { userId: OWNER, email: "owner@example.test" });
    const result = await service.listTrips(makeContext(db(), fake));
    expect(result.ok && result.data.map((trip) => trip.destination).sort()).toEqual([
      "Lisbon",
      "San Diego",
    ]);
  });
});

describe("idempotent", () => {
  it("running twice yields the same state", async () => {
    await seedSyntheticData(db(), OWNER, SAMPLE_TODAY);
    const first = await state(OWNER);
    await seedSyntheticData(db(), OWNER, SAMPLE_TODAY);
    expect(await state(OWNER)).toBe(first);
    const counts = JSON.parse(first).counts;
    expect(counts).toEqual({
      trips: "2",
      items: expect.any(String),
      progress: counts.items,
      staples: "11",
    });
  });

  it("does not bump staple versions when nothing changed", async () => {
    await seedSyntheticData(db(), OWNER, SAMPLE_TODAY);
    await seedSyntheticData(db(), OWNER, SAMPLE_TODAY);
    const versions = (
      await ctx.client.query<{ version: number }>('SELECT DISTINCT version FROM "staples"')
    ).rows;
    expect(versions).toEqual([{ version: 1 }]);
  });

  it("restores the sample trips and staples after edits, leaving unrelated trips alone", async () => {
    await seedSyntheticData(db(), OWNER, SAMPLE_TODAY);
    const canonical = JSON.stringify(await bySlug(OWNER, "Lisbon"));
    const extraId = "00000000-0000-4000-8000-0000000000aa";
    await ctx.client.query(
      `INSERT INTO trips (id, owner_id, destination, start_date, end_date, days, daily_days) VALUES ($1, $2, 'Mine', '2030-01-01', '2030-01-02', 2, 0)`,
      [extraId, OWNER],
    );
    await ctx.client.query(
      `UPDATE trips SET ready = false, destination = 'Edited' WHERE destination = 'Lisbon'`,
    );
    await ctx.client.query(`UPDATE staples SET qty = 9 WHERE semantic_id = 'socks'`);

    await seedSyntheticData(db(), OWNER, SAMPLE_TODAY);
    expect(JSON.stringify(await bySlug(OWNER, "Lisbon"))).toBe(canonical);
    expect((await listStaples(db(), OWNER)).find((staple) => staple.id === "socks")?.qty).toBe(1);
    const mine = await ctx.client.query<{ destination: string }>(
      "SELECT destination FROM trips WHERE id = $1",
      [extraId],
    );
    expect(mine.rows).toEqual([{ destination: "Mine" }]);
  });

  it("leaves other owners' data alone and gives each owner their own sample trips", async () => {
    await seedSyntheticData(db(), "owner-one", SAMPLE_TODAY);
    await seedSyntheticData(db(), "owner-two", SAMPLE_TODAY);
    const one = await loadTrips(db(), "owner-one", { filter: "live" });
    const two = await loadTrips(db(), "owner-two", { filter: "live" });
    expect(one).toHaveLength(2);
    expect(two).toHaveLength(2);
    expect(new Set([...one, ...two].map((trip) => trip.id)).size).toBe(4);
    await seedSyntheticData(db(), "owner-one", SAMPLE_TODAY);
    expect(await loadTrips(db(), "owner-two", { filter: "live" })).toHaveLength(2);
  });
});

describe("sampleTripId", () => {
  it("is a stable, valid uuid that differs by owner and by trip", () => {
    const a = sampleTripId("owner-a", "san-diego");
    expect(a).toBe(sampleTripId("owner-a", "san-diego"));
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(
      new Set([a, sampleTripId("owner-a", "lisbon"), sampleTripId("owner-b", "san-diego")]).size,
    ).toBe(3);
  });

  it("sampleTrips uses those ids", () => {
    expect(sampleTrips("owner-a", SAMPLE_TODAY).map((trip) => trip.id)).toEqual([
      sampleTripId("owner-a", "san-diego"),
      sampleTripId("owner-a", "lisbon"),
    ]);
  });
});

describe("addDays", () => {
  it.each([
    ["2026-10-16", 7, "2026-10-23"],
    ["2026-10-16", -43, "2026-09-03"],
    ["2026-10-29", 3, "2026-11-01"],
    ["2026-12-28", 7, "2027-01-04"],
    ["2026-01-03", -5, "2025-12-29"],
    ["2028-02-27", 3, "2028-03-01"],
    ["2027-02-27", 3, "2027-03-02"],
    ["2026-03-08", 1, "2026-03-09"],
    ["2026-10-16", 0, "2026-10-16"],
  ])("%s %+d days = %s", (date, days, expected) => {
    expect(addDays(date, days)).toBe(expected);
  });
});

describe("sample dates are relative to the run date", () => {
  it("land on the prototype's exact dates when the run date is the prototype's 'today'", () => {
    const [sanDiego, lisbon] = sampleTrips("o", SAMPLE_TODAY);
    expect([sanDiego.start, sanDiego.end]).toEqual(["2026-10-23", "2026-10-27"]);
    expect([lisbon.start, lisbon.end]).toEqual(["2026-09-03", "2026-09-07"]);
  });

  it("are the constants the offsets say", () => {
    expect(SAN_DIEGO_STARTS_IN_DAYS).toBe(7);
    expect(LISBON_STARTED_DAYS_AGO).toBe(43);
  });

  it.each([SAMPLE_TODAY, "2026-12-28", "2028-02-27", "2030-01-31", "2035-07-04", "2026-03-08"])(
    "run on %s: San Diego is upcoming, Lisbon is past, both five days long",
    async (today) => {
      await resetData(ctx.client);
      await seedSyntheticData(db(), OWNER, today);
      const sanDiego = await bySlug(OWNER, "San Diego");
      const lisbon = await bySlug(OWNER, "Lisbon");
      expect(classifyTrip(sanDiego as unknown as LifecycleTrip, today)).toBe("upcoming");
      expect(classifyTrip(lisbon as unknown as LifecycleTrip, today)).toBe("past");
      expect(sanDiego.start).toBe(addDays(today, 7));
      expect(sanDiego.days).toBe(5);
      expect(lisbon.end).toBe(addDays(today, -39));
      expect(lisbon.days).toBe(5);
      // The simulated forecast label follows the same run date: close for San Diego, never for a past trip's start.
      expect(sanDiego.weather.label).toBe("Close forecast");
      expect(lisbon.weather.label).toBe("Seasonal outlook");
    },
  );

  it("re-running on a later day moves the sample trips and keeps San Diego upcoming", async () => {
    await seedSyntheticData(db(), OWNER, "2026-10-16");
    await seedSyntheticData(db(), OWNER, "2026-11-30");
    const trips = await loadTrips(db(), OWNER, { filter: "live" });
    expect(trips).toHaveLength(2);
    expect((await bySlug(OWNER, "San Diego")).start).toBe("2026-12-07");
    expect(
      classifyTrip((await bySlug(OWNER, "San Diego")) as unknown as LifecycleTrip, "2026-11-30"),
    ).toBe("upcoming");
  });
});
