// Multi-destination trips through the data layer (epic #107): stops round-trip, authz, weather settings and
// per-item suggestion status. Fictional places and dates; PGlite, no network.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createMigratedDb, resetData } from "../db/__fixtures__/db";
import type { Db } from "../db/retention";
import type { SampleLocation } from "../../domain/trip-stops";
import {
  CONFIG,
  createFakeAuth,
  makeContext,
  makeStoredTrip,
  OTHER_OWNER,
  OWNER,
  seedOwner,
  seedTrip,
  signedInAs,
} from "./__fixtures__/seed";
import type { Result } from "./result";
import { setDataLogSink } from "./safe-log";
import * as service from "./service";
import { insertTrip, loadTrip, saveTrip } from "./trip-store";

const place = (id: string, city: string): SampleLocation => ({
  id,
  city,
  region: "Sample Region",
  country: "Sampleland",
  countryCode: "SL",
  label: `${city}, Sample Region, Sampleland`,
});
const PLACES: Record<string, SampleLocation> = {
  alpha: place("alpha", "Alpha"),
  beta: place("beta", "Beta"),
  gamma: place("gamma", "Gamma"),
  // A provider place: coordinates carry more precision than the 2 decimals that may be stored.
  "open-meteo-7": {
    ...place("open-meteo-7", "Geoton"),
    provider: "open-meteo",
    providerPlaceId: "7",
    latitude: 12.3456,
    longitude: -45.6789,
    timezone: "Etc/UTC",
  },
};
let resolverDown = false;

let ctx: Awaited<ReturnType<typeof createMigratedDb>>;
const fake = createFakeAuth();
const db = () => ctx.db as unknown as Db;
const context = () => ({
  ...makeContext(db(), fake),
  resolveLocation: async (id: string) => {
    if (resolverDown) throw new Error("provider down");
    return PLACES[id] ?? null;
  },
});
const as = (user: typeof OWNER | null) => signedInAs(fake, user);

beforeAll(async () => {
  ctx = await createMigratedDb();
});
beforeEach(async () => {
  await resetData(ctx.client);
  as(OWNER);
  resolverDown = false;
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

const ROUTE = [
  { location: { id: "alpha" }, arrive: "2030-05-01", leave: "2030-05-04" },
  { location: { id: "beta" }, arrive: "2030-05-04", leave: "2030-05-06" },
  { location: { id: "gamma" }, arrive: "2030-05-06", leave: "2030-05-09" },
];
const create = (overrides: Record<string, unknown> = {}) =>
  service.createTrip(context(), { stops: ROUTE, config: CONFIG, ...overrides });

describe("createTrip with stops", () => {
  it("saves every stop in order and derives the trip dates, days and title from them", async () => {
    const trip = data(await create());
    expect(trip.stops.map((stop) => [stop.location.city, stop.arrive, stop.leave])).toEqual([
      ["Alpha", "2030-05-01", "2030-05-04"],
      ["Beta", "2030-05-04", "2030-05-06"],
      ["Gamma", "2030-05-06", "2030-05-09"],
    ]);
    expect(trip).toMatchObject({
      destination: "Alpha → Beta → Gamma",
      start: "2030-05-01",
      end: "2030-05-09",
      days: 9,
      locationId: "alpha",
    });
    expect(data(await service.getTrip(context(), { tripId: trip.id })).stops).toEqual(trip.stops);
    const rows = await ctx.client.query(
      `SELECT start_date::text AS s, end_date::text AS e FROM trips`,
    );
    expect(rows.rows).toEqual([{ s: "2030-05-01", e: "2030-05-09" }]);
  });

  it("stores the resolved place, not what the browser claimed, with coordinates rounded to 2 decimals", async () => {
    const trip = data(
      await create({
        stops: [
          {
            location: { id: "open-meteo-7", city: "Forged", latitude: 1.23456 },
            arrive: "2030-05-01",
            leave: "2030-05-03",
          },
        ],
      }),
    );
    expect(trip.stops[0].location).toMatchObject({
      city: "Geoton",
      provider: "open-meteo",
      providerPlaceId: "7",
      latitude: 12.35,
      longitude: -45.68,
      timezone: "Etc/UTC",
    });
    expect(trip.place).toMatchObject({ latitude: 12.35, longitude: -45.68 });
  });

  it("looks the same place id up once even when it is a stop twice", async () => {
    const calls: string[] = [];
    const twice = {
      ...context(),
      resolveLocation: async (id: string) => (calls.push(id), PLACES[id] ?? null),
    };
    const result = await service.createTrip(twice, {
      stops: [
        { location: { id: "alpha" }, arrive: "2030-05-01", leave: "2030-05-03" },
        { location: { id: "beta" }, arrive: "2030-05-03", leave: "2030-05-05" },
        { location: { id: "alpha" }, arrive: "2030-05-05", leave: "2030-05-07" },
      ],
      config: CONFIG,
    });
    expect(data(result).stops).toHaveLength(3);
    expect(calls).toEqual(["alpha", "beta"]);
  });

  it("accepts a single stop, including a day trip", async () => {
    const trip = data(
      await create({
        stops: [{ location: { id: "alpha" }, arrive: "2030-05-01", leave: "2030-05-01" }],
      }),
    );
    expect(trip).toMatchObject({ destination: "Alpha", days: 1 });
    expect(trip.stops).toHaveLength(1);
  });

  it("a single-destination trip in the old form gets exactly one stop", async () => {
    const trip = data(
      await service.createTrip(context(), {
        location: { id: "alpha" },
        start: "2030-05-01",
        end: "2030-05-04",
        config: CONFIG,
      }),
    );
    expect(trip.stops).toEqual([
      { location: PLACES.alpha, arrive: "2030-05-01", leave: "2030-05-04" },
    ]);
  });

  it.each([
    ["a gap", [ROUTE[0], { ...ROUTE[1], arrive: "2030-05-05" }]],
    ["an overlap", [ROUTE[0], { ...ROUTE[1], arrive: "2030-05-03" }]],
    ["a zero-night stop", [ROUTE[0], { ...ROUTE[1], leave: "2030-05-04" }]],
    ["a leave before arrive", [{ ...ROUTE[0], leave: "2030-04-01" }]],
    [
      "seven stops",
      Array.from({ length: 7 }, (_, index) => ({
        location: { id: "alpha" },
        arrive: `2030-05-0${index + 1}`,
        leave: `2030-05-0${index + 2}`,
      })),
    ],
    ["no stops", []],
    ["an impossible date", [{ ...ROUTE[0], arrive: "2030-02-30" }]],
  ])("refuses %s as INVALID_INPUT and saves nothing", async (_name, stops) => {
    expect(errorOf(await create({ stops }))?.code).toBe("INVALID_INPUT");
    expect(await ctx.client.query(`SELECT 1 FROM trips`)).toMatchObject({ rows: [] });
  });

  it("refuses an unknown place, and reports UNAVAILABLE when the lookup is down", async () => {
    expect(
      errorOf(await create({ stops: [{ ...ROUTE[0], location: { id: "nowhere" } }] }))?.code,
    ).toBe("INVALID_INPUT");
    resolverDown = true;
    expect(errorOf(await create())?.code).toBe("UNAVAILABLE");
  });

  it("refuses mixing the two forms, and a half-given old form, naming the fields", async () => {
    const mixed = errorOf(await create({ location: { id: "alpha" }, start: "2030-05-01" }));
    expect(mixed).toMatchObject({ code: "INVALID_INPUT" });
    expect(mixed?.fields).toEqual(expect.arrayContaining(["location", "start"]));
    const half = errorOf(
      await service.createTrip(context(), { location: { id: "alpha" }, config: CONFIG }),
    );
    expect(half?.fields).toEqual(expect.arrayContaining(["start", "end"]));
  });
});

describe("copyTrip with stops", () => {
  it("copies a multi-stop trip's preferences and saves the new stops", async () => {
    const source = data(await create());
    const copy = data(
      await service.copyTrip(context(), {
        sourceId: source.id,
        stops: ROUTE.map((stop, index) => ({
          ...stop,
          arrive: `2030-07-${String(1 + [0, 3, 5][index]).padStart(2, "0")}`,
          leave: `2030-07-${String(1 + [3, 5, 8][index]).padStart(2, "0")}`,
        })),
      }),
    );
    expect(copy).toMatchObject({
      copiedFrom: source.id,
      destination: "Alpha → Beta → Gamma",
      start: "2030-07-01",
      end: "2030-07-09",
    });
    expect(copy.config).toEqual(source.config);
  });

  it("the old form chooses one place and dates anew, whatever route the source had", async () => {
    const source = data(await create());
    const copy = data(
      await service.copyTrip(context(), {
        sourceId: source.id,
        location: { id: "beta" },
        start: "2030-07-01",
        end: "2030-07-03",
      }),
    );
    expect(copy.stops.map((stop) => stop.location.city)).toEqual(["Beta"]);
    expect(copy).toMatchObject({ start: "2030-07-01", end: "2030-07-03", destination: "Beta" });
  });

  it("another owner's trip is NOT_FOUND as a copy source", async () => {
    const source = data(await create());
    as(OTHER_OWNER);
    expect(
      errorOf(await service.copyTrip(context(), { sourceId: source.id, stops: ROUTE }))?.code,
    ).toBe("NOT_FOUND");
  });
});

describe("setTripStops", () => {
  it("replaces the stops, keeps start/end/days in step, and the title follows an untouched route", async () => {
    const trip = data(await create());
    const next = data(
      await service.setTripStops(context(), {
        tripId: trip.id,
        stops: [
          { location: { id: "beta" }, arrive: "2030-05-02", leave: "2030-05-04" },
          { location: { id: "alpha" }, arrive: "2030-05-04", leave: "2030-05-05" },
        ],
      }),
    );
    expect(next.stops.map((stop) => stop.location.city)).toEqual(["Beta", "Alpha"]);
    expect(next).toMatchObject({
      destination: "Beta → Alpha",
      start: "2030-05-02",
      end: "2030-05-05",
      days: 4,
      dailyDays: 2,
      locationId: "beta",
    });
    expect(await ctx.client.query(`SELECT count(*)::int AS n FROM trip_stops`)).toMatchObject({
      rows: [{ n: 2 }],
    });
    expect(data(await service.getTrip(context(), { tripId: trip.id }))).toEqual(next);
  });

  it("leaves a title the person edited alone", async () => {
    const trip = data(await create());
    await ctx.client.query(`UPDATE trips SET destination = 'Spring trip'`);
    const next = data(
      await service.setTripStops(context(), { tripId: trip.id, stops: ROUTE.slice(0, 1) }),
    );
    expect(next.destination).toBe("Spring trip");
    expect(next.stops).toHaveLength(1);
  });

  it("refuses invalid stops and changes nothing", async () => {
    const trip = data(await create());
    const bad = [ROUTE[0], { ...ROUTE[1], arrive: "2030-05-05" }];
    expect(
      errorOf(await service.setTripStops(context(), { tripId: trip.id, stops: bad }))?.code,
    ).toBe("INVALID_INPUT");
    expect(data(await service.getTrip(context(), { tripId: trip.id })).stops).toEqual(trip.stops);
  });

  it("is NOT_FOUND for a missing trip, a deleted trip and another owner's trip", async () => {
    const trip = data(await create());
    const other = "00000000-0000-4000-8000-0000000000ff";
    expect(
      errorOf(await service.setTripStops(context(), { tripId: other, stops: ROUTE }))?.code,
    ).toBe("NOT_FOUND");
    as(OTHER_OWNER);
    expect(
      errorOf(await service.setTripStops(context(), { tripId: trip.id, stops: ROUTE }))?.code,
    ).toBe("NOT_FOUND");
    as(OWNER);
    data(await service.removeTrip(context(), { tripId: trip.id }));
    expect(
      errorOf(await service.setTripStops(context(), { tripId: trip.id, stops: ROUTE }))?.code,
    ).toBe("NOT_FOUND");
  });
});

describe("authorization", () => {
  it("another owner cannot read a trip's stops, and the rows are never returned to them", async () => {
    const trip = data(await create());
    as(OTHER_OWNER);
    expect(errorOf(await service.getTrip(context(), { tripId: trip.id }))?.code).toBe("NOT_FOUND");
    expect(data(await service.listTrips(context()))).toEqual([]);
    expect(await loadTrip(db(), OTHER_OWNER.userId, trip.id)).toBeNull();
  });

  it("the store refuses to write stops under another owner's trip", async () => {
    const trip = data(await create());
    await seedOwner(db(), OTHER_OWNER.userId);
    expect(await saveTrip(db(), OTHER_OWNER.userId, { ...trip, destination: "Taken" })).toBe(false);
    await expect(insertTrip(db(), OTHER_OWNER.userId, trip)).rejects.toThrow();
    expect(data(await service.listTrips({ ...context() }))).toHaveLength(1);
    const stops = await ctx.client.query(`SELECT owner_id FROM trip_stops`);
    expect(new Set(stops.rows.map((row) => (row as { owner_id: string }).owner_id))).toEqual(
      new Set([OWNER.userId]),
    );
  });

  it("another owner cannot list or write a trip's weather suggestions", async () => {
    const trip = data(await create());
    as(OTHER_OWNER);
    expect(
      errorOf(await service.listTripWeatherSuggestions(context(), { tripId: trip.id }))?.code,
    ).toBe("NOT_FOUND");
    expect(
      errorOf(
        await service.setTripWeatherSuggestion(context(), {
          tripId: trip.id,
          semanticId: "weather-umbrella",
          status: "skipped",
          ruleSignature: "x",
        }),
      )?.code,
    ).toBe("NOT_FOUND");
    as(OWNER);
    expect(data(await service.listTripWeatherSuggestions(context(), { tripId: trip.id }))).toEqual([
      { semanticId: "weather-umbrella", status: "pending", ruleSignature: "" },
    ]);
  });

  it("weather settings belong to the signed-in user only", async () => {
    data(
      await service.updateWeatherSettings(context(), { weatherOptIn: true, temperatureUnit: "C" }),
    );
    as(OTHER_OWNER);
    expect(data(await service.getWeatherSettings(context()))).toEqual({
      weatherOptIn: false,
      temperatureUnit: "F",
    });
    as(null);
    expect(errorOf(await service.getWeatherSettings(context()))?.code).toBe("UNAUTHENTICATED");
    expect(errorOf(await service.updateWeatherSettings(context(), {}))?.code).toBe(
      "UNAUTHENTICATED",
    );
  });
});

describe("weather settings", () => {
  it("default to off and Fahrenheit, change one field at a time, and refuse an unknown unit", async () => {
    expect(data(await service.getWeatherSettings(context()))).toEqual({
      weatherOptIn: false,
      temperatureUnit: "F",
    });
    expect(data(await service.updateWeatherSettings(context(), { weatherOptIn: true }))).toEqual({
      weatherOptIn: true,
      temperatureUnit: "F",
    });
    expect(data(await service.updateWeatherSettings(context(), { temperatureUnit: "C" }))).toEqual({
      weatherOptIn: true,
      temperatureUnit: "C",
    });
    expect(data(await service.updateWeatherSettings(context(), {}))).toEqual({
      weatherOptIn: true,
      temperatureUnit: "C",
    });
    expect(
      data(await service.updateWeatherSettings(context(), { weatherOptIn: false })),
    ).toMatchObject({
      weatherOptIn: false,
    });
    expect(
      errorOf(await service.updateWeatherSettings(context(), { temperatureUnit: "K" }))?.code,
    ).toBe("INVALID_INPUT");
  });
});

describe("weather suggestion status", () => {
  it("keeps one row per (trip, semantic id) with a status and a rule signature", async () => {
    const trip = data(await create());
    const set = (semanticId: string, status: string, ruleSignature: string) =>
      service.setTripWeatherSuggestion(context(), {
        tripId: trip.id,
        semanticId,
        status,
        ruleSignature,
      });
    data(await set("weather-rain-jacket", "skipped", "rain>=2d"));
    const listed = data(await set("weather-sunscreen", "accepted", "uv>=3"));
    expect(listed).toEqual([
      { semanticId: "weather-rain-jacket", status: "skipped", ruleSignature: "rain>=2d" },
      { semanticId: "weather-sunscreen", status: "accepted", ruleSignature: "uv>=3" },
      { semanticId: "weather-umbrella", status: "pending", ruleSignature: "" },
    ]);
    // Setting it again updates the same row.
    const again = data(await set("weather-rain-jacket", "pending", "rain>=3d"));
    expect(again.filter((entry) => entry.semanticId === "weather-rain-jacket")).toEqual([
      { semanticId: "weather-rain-jacket", status: "pending", ruleSignature: "rain>=3d" },
    ]);
    expect(data(await service.listTripWeatherSuggestions(context(), { tripId: trip.id }))).toEqual(
      again,
    );
  });

  it("does not disturb the legacy umbrella state on the trip", async () => {
    const trip = data(await create());
    data(
      await service.setTripWeatherSuggestion(context(), {
        tripId: trip.id,
        semanticId: "weather-rain-jacket",
        status: "accepted",
        ruleSignature: "x",
      }),
    );
    data(await service.acceptTripWeather(context(), { tripId: trip.id }));
    const reloaded = data(await service.getTrip(context(), { tripId: trip.id }));
    expect(reloaded.weather.status).toBe("accepted");
    const rain = data(await service.listTripWeatherSuggestions(context(), { tripId: trip.id }));
    expect(rain.find((entry) => entry.semanticId === "weather-rain-jacket")?.status).toBe(
      "accepted",
    );
  });

  it("is NOT_FOUND for a trip in Recently deleted, for both reading and writing", async () => {
    const trip = data(await create());
    data(await service.removeTrip(context(), { tripId: trip.id }));
    const input = {
      tripId: trip.id,
      semanticId: "weather-umbrella",
      status: "skipped",
      ruleSignature: "x",
    };
    expect(errorOf(await service.setTripWeatherSuggestion(context(), input))?.code).toBe(
      "NOT_FOUND",
    );
    expect(
      errorOf(await service.listTripWeatherSuggestions(context(), { tripId: trip.id }))?.code,
    ).toBe("NOT_FOUND");
  });

  it("refuses raw-weather-sized signatures, unknown statuses and a missing trip", async () => {
    const trip = data(await create());
    const base = {
      tripId: trip.id,
      semanticId: "weather-umbrella",
      status: "skipped",
      ruleSignature: "x",
    };
    expect(
      errorOf(
        await service.setTripWeatherSuggestion(context(), {
          ...base,
          ruleSignature: "x".repeat(201),
        }),
      )?.code,
    ).toBe("INVALID_INPUT");
    expect(
      errorOf(await service.setTripWeatherSuggestion(context(), { ...base, status: "maybe" }))
        ?.code,
    ).toBe("INVALID_INPUT");
    expect(
      errorOf(
        await service.setTripWeatherSuggestion(context(), {
          ...base,
          tripId: "00000000-0000-4000-8000-0000000000ff",
        }),
      )?.code,
    ).toBe("NOT_FOUND");
    expect(
      errorOf(
        await service.listTripWeatherSuggestions(context(), {
          tripId: "00000000-0000-4000-8000-0000000000ff",
        }),
      )?.code,
    ).toBe("NOT_FOUND");
  });
});

describe("the trip store", () => {
  it("writes the one stop of a trip saved without stops, from the trip's own place", async () => {
    await seedOwner(db(), OWNER.userId);
    const trip = makeStoredTrip({
      stops: [],
      place: {
        provider: "open-meteo",
        placeId: "7",
        region: "Sample Region",
        country: "Sampleland",
        countryCode: "SL",
        latitude: 12.35,
        longitude: -45.68,
        timezone: "Etc/UTC",
      },
    });
    await insertTrip(db(), OWNER.userId, trip);
    const loaded = await loadTrip(db(), OWNER.userId, trip.id);
    expect(loaded?.stops).toEqual([
      {
        location: {
          id: "sample-a",
          city: "Sampleton",
          region: "Sample Region",
          country: "Sampleland",
          countryCode: "SL",
          label: "Sampleton, Sample Region, Sampleland",
          provider: "open-meteo",
          providerPlaceId: "7",
          latitude: 12.35,
          longitude: -45.68,
          timezone: "Etc/UTC",
        },
        arrive: trip.start,
        leave: trip.end,
      },
    ]);
  });

  it("a trip with no place at all still gets one stop (city from the title)", async () => {
    await seedOwner(db(), OWNER.userId);
    const trip = makeStoredTrip({ stops: [], locationId: null, locationLabel: null });
    await insertTrip(db(), OWNER.userId, trip);
    const loaded = await loadTrip(db(), OWNER.userId, trip.id);
    expect(loaded?.stops).toEqual([
      {
        location: {
          id: "",
          city: "Sampleton",
          region: "",
          country: "",
          countryCode: "",
          label: "Sampleton",
        },
        arrive: trip.start,
        leave: trip.end,
      },
    ]);
  });

  it("derives start and end from the stops it is given, and refuses invalid stops", async () => {
    await seedOwner(db(), OWNER.userId);
    const base = makeStoredTrip();
    const stop = (city: string, arrive: string, leave: string) => ({
      location: { ...PLACES.alpha, city },
      arrive,
      leave,
    });
    const trip = {
      ...base,
      stops: [stop("A", "2030-05-02", "2030-05-04"), stop("B", "2030-05-04", "2030-05-07")],
    };
    await insertTrip(db(), OWNER.userId, trip);
    const loaded = await loadTrip(db(), OWNER.userId, trip.id);
    expect(loaded).toMatchObject({ start: "2030-05-02", end: "2030-05-07" });
    await expect(
      saveTrip(db(), OWNER.userId, {
        ...trip,
        stops: [stop("A", "2030-05-02", "2030-05-04"), stop("B", "2030-05-09", "2030-05-10")],
      }),
    ).rejects.toMatchObject({ name: "Refusal" });
  });

  it("seedTrip fixtures keep working", async () => {
    const trip = await seedTrip(db(), OWNER.userId);
    expect((await loadTrip(db(), OWNER.userId, trip.id))?.stops).toHaveLength(1);
  });
});
