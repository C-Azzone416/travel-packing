// Per-trip stamp label overrides through the data layer (#151): validation, normalising to automatic, owner scope, the route
// edit that shrinks the cluster, and copy resetting them. Fictional places and dates; PGlite, no network.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createMigratedDb, resetData } from "../db/__fixtures__/db";
import type { Db } from "../db/retention";
import type { SampleLocation } from "../../domain/trip-stops";
import {
  CONFIG,
  createFakeAuth,
  makeContext,
  OTHER_OWNER,
  OWNER,
  signedInAs,
} from "./__fixtures__/seed";
import type { Result } from "./result";
import { setDataLogSink } from "./safe-log";
import * as service from "./service";

const place = (id: string, city: string, countryCode: string): SampleLocation => ({
  id,
  city,
  region: "Sample Region",
  country: "Sampleland",
  countryCode,
  label: `${city}, Sample Region, Sampleland`,
});
const PLACES: Record<string, SampleLocation> = {
  lisbon: place("lisbon", "Lisbon", "PT"),
  porto: place("porto", "Porto", "PT"),
  madrid: place("madrid", "Madrid", "ES"),
};

let ctx: Awaited<ReturnType<typeof createMigratedDb>>;
const fake = createFakeAuth();
const db = () => ctx.db as unknown as Db;
const context = () => ({
  ...makeContext(db(), fake),
  resolveLocation: async (id: string) => PLACES[id] ?? null,
});
const as = (user: typeof OWNER | null) => signedInAs(fake, user);

beforeAll(async () => {
  ctx = await createMigratedDb();
});
beforeEach(async () => {
  await resetData(ctx.client);
  as(OWNER);
  setDataLogSink(() => {});
});
afterEach(() => setDataLogSink());
afterAll(async () => {
  await ctx.client.close();
});

function data<T>(result: Result<T>): T {
  if (!result.ok)
    throw new Error(
      `expected ok, got ${result.error.code} ${result.error.reason ?? ""} ${result.error.fields ?? ""}`,
    );
  return result.data;
}
const errorOf = (result: Result<unknown>) => (result.ok ? null : result.error);

const stop = (id: string, arrive: string, leave: string) => ({ location: { id }, arrive, leave });
const TWO_COUNTRIES = [
  stop("lisbon", "2030-05-01", "2030-05-04"),
  stop("madrid", "2030-05-04", "2030-05-07"),
];
const create = (stops: unknown[]) => service.createTrip(context(), { stops, config: CONFIG });
const setLabels = (tripId: string, slot1: string | null, slot2: string | null) =>
  service.setTripStampLabels(context(), { tripId, slot1, slot2 });
const stored = async () =>
  (await ctx.client.query(`SELECT stamp_label_1 AS a, stamp_label_2 AS b FROM trips`)).rows;

describe("setTripStampLabels", () => {
  it("a new trip has no override", async () => {
    const trip = data(await create(TWO_COUNTRIES));
    expect(trip.stampLabels).toEqual([null, null]);
    expect(await stored()).toEqual([{ a: null, b: null }]);
  });

  it("trims and upper-cases, saves both slots, and the trip reads them back", async () => {
    const trip = data(await create(TWO_COUNTRIES));
    const saved = data(await setLabels(trip.id, " abc ", "7x9"));
    expect(saved.trip.stampLabels).toEqual(["ABC", "7X9"]);
    expect(await stored()).toEqual([{ a: "ABC", b: "7X9" }]);
    expect(data(await service.getTrip(context(), { tripId: trip.id })).stampLabels).toEqual([
      "ABC",
      "7X9",
    ]);
  });

  it("blank, null, or the same as the automatic label stores null (the stamp keeps following the route)", async () => {
    const trip = data(await create(TWO_COUNTRIES));
    await setLabels(trip.id, "ABC", "XYZ");
    data(await setLabels(trip.id, "  ", null));
    expect(await stored()).toEqual([{ a: null, b: null }]);
    // PRT and ESP are what these two stops say on their own.
    data(await setLabels(trip.id, "prt", "ESP"));
    expect(await stored()).toEqual([{ a: null, b: null }]);
  });

  it("refuses anything that is not exactly 3 of A-Z and 0-9, naming the slot, and saves nothing", async () => {
    const trip = data(await create(TWO_COUNTRIES));
    await setLabels(trip.id, "KEP", null);
    for (const bad of ["AB", "ABCD", "A C", "A-C", "ÀBC", "AB😀", "a\nb"]) {
      const first = errorOf(await setLabels(trip.id, bad, null));
      expect(first, JSON.stringify(bad)).toMatchObject({
        code: "INVALID_INPUT",
        fields: ["slot1"],
      });
      const second = errorOf(await setLabels(trip.id, null, bad));
      expect(second, JSON.stringify(bad)).toMatchObject({
        code: "INVALID_INPUT",
        fields: ["slot2"],
      });
    }
    expect(errorOf(await setLabels(trip.id, "no", "x"))?.fields).toEqual(["slot1", "slot2"]);
    expect(await stored()).toEqual([{ a: "KEP", b: null }]);
  });

  it("refuses a label for a second stamp when the route has only one", async () => {
    const trip = data(await create([stop("lisbon", "2030-05-01", "2030-05-04")]));
    expect(errorOf(await setLabels(trip.id, null, "ABC"))).toMatchObject({
      code: "INVALID_INPUT",
      fields: ["slot2"],
    });
    expect(data(await setLabels(trip.id, "ABC", null)).trip.stampLabels).toEqual(["ABC", null]);
  });

  it("is owner-scoped: another owner's trip, or a missing one, is NOT_FOUND and unchanged", async () => {
    const trip = data(await create(TWO_COUNTRIES));
    as(OTHER_OWNER);
    expect(errorOf(await setLabels(trip.id, "ABC", null))?.code).toBe("NOT_FOUND");
    expect(
      errorOf(await setLabels("00000000-0000-4000-8000-0000000000ff", "ABC", null))?.code,
    ).toBe("NOT_FOUND");
    expect(await stored()).toEqual([{ a: null, b: null }]);
  });

  it("does not accept a malformed request", async () => {
    const trip = data(await create(TWO_COUNTRIES));
    const bad = await service.setTripStampLabels(context(), { tripId: trip.id, slot1: 5 });
    expect(errorOf(bad)?.code).toBe("INVALID_INPUT");
  });

  it("keeps the trip's other settings: a theme change or a toggle leaves the labels alone", async () => {
    const trip = data(await create(TWO_COUNTRIES));
    await setLabels(trip.id, "ABC", null);
    data(await service.setTripTheme(context(), { tripId: trip.id, theme: "beach" }));
    expect(await stored()).toEqual([{ a: "ABC", b: null }]);
  });
});

describe("a route edit and the stamp labels", () => {
  it("keeps both overrides while the route still has two stamps", async () => {
    const trip = data(await create(TWO_COUNTRIES));
    await setLabels(trip.id, "ABC", "XYZ");
    data(
      await service.setTripStops(context(), {
        tripId: trip.id,
        stops: [
          stop("lisbon", "2030-05-01", "2030-05-03"),
          stop("madrid", "2030-05-03", "2030-05-08"),
        ],
      }),
    );
    expect(await stored()).toEqual([{ a: "ABC", b: "XYZ" }]);
  });

  it("clears slot 2, not slot 1, when the route shrinks to one stamp, and growing again does not bring it back", async () => {
    const trip = data(await create(TWO_COUNTRIES));
    await setLabels(trip.id, "ABC", "XYZ");
    const shrunk = data(
      await service.setTripStops(context(), {
        tripId: trip.id,
        stops: [
          stop("lisbon", "2030-05-01", "2030-05-04"),
          stop("porto", "2030-05-04", "2030-05-07"),
        ],
      }),
    );
    expect(shrunk.stampLabels).toEqual(["ABC", null]);
    expect(await stored()).toEqual([{ a: "ABC", b: null }]);
    const grown = data(
      await service.setTripStops(context(), { tripId: trip.id, stops: TWO_COUNTRIES }),
    );
    expect(grown.stampLabels).toEqual(["ABC", null]);
  });
});

describe("copy trip resets the stamp labels", () => {
  it("the copy is automatic on both slots, and the original keeps its labels", async () => {
    const source = data(await create(TWO_COUNTRIES));
    await setLabels(source.id, "ABC", "XYZ");
    const copy = data(
      await service.copyTrip(context(), {
        sourceId: source.id,
        stops: [
          stop("lisbon", "2030-07-01", "2030-07-04"),
          stop("madrid", "2030-07-04", "2030-07-07"),
        ],
      }),
    );
    expect(copy.stampLabels).toEqual([null, null]);
    const rows = (
      await ctx.client.query(
        `SELECT id, stamp_label_1 AS a, stamp_label_2 AS b FROM trips ORDER BY created_at`,
      )
    ).rows;
    expect(rows).toEqual([
      { id: source.id, a: "ABC", b: "XYZ" },
      { id: copy.id, a: null, b: null },
    ]);
  });

  it("a one-place copy (the old form) is automatic too", async () => {
    const source = data(await create(TWO_COUNTRIES));
    await setLabels(source.id, "ABC", "XYZ");
    const copy = data(
      await service.copyTrip(context(), {
        sourceId: source.id,
        location: { id: "madrid" },
        start: "2030-07-01",
        end: "2030-07-03",
      }),
    );
    expect(copy.stampLabels).toEqual([null, null]);
  });
});
