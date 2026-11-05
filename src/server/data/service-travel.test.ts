// Home city, trip origin, travel mode and trip name through the data layer (#379): validation, owner scope, defaults, what a
// copy takes over, privacy (rounded coordinates, nothing in the log, gone with the trip), and legacy rows. Fictional
// places and dates; PGlite, no network.

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

const provider = (
  id: string,
  city: string,
  countryCode: string,
  latitude: number,
  longitude: number,
): SampleLocation => ({
  id,
  city,
  region: "Sample Region",
  country: "Sampleland",
  countryCode,
  label: `${city}, Sample Region, Sampleland`,
  provider: "open-meteo",
  providerPlaceId: `p-${id}`,
  latitude,
  longitude,
  timezone: "Europe/Lisbon",
});
const PLACES: Record<string, SampleLocation> = {
  seattle: provider("seattle", "Seattle", "US", 47.60621, -122.33207),
  portland: provider("portland", "Portland", "US", 45.52345, -122.67621),
  lisbon: provider("lisbon", "Lisbon", "PT", 38.72252, -9.13934),
  porto: provider("porto", "Porto", "PT", 41.14961, -8.61099),
  // A curated place: no provider, no coordinates.
  paris: {
    id: "paris",
    city: "Paris",
    region: "Ile-de-France",
    country: "France",
    countryCode: "FR",
    label: "Paris, Ile-de-France, France",
  },
};

let ctx: Awaited<ReturnType<typeof createMigratedDb>>;
const fake = createFakeAuth();
const db = () => ctx.db as unknown as Db;
let resolverDown = false;
const resolved: string[] = [];
const context = () => ({
  ...makeContext(db(), fake),
  resolveLocation: async (id: string) => {
    resolved.push(id);
    if (resolverDown) throw new Error("down");
    return PLACES[id] ?? null;
  },
});
const as = (user: typeof OWNER | null) => signedInAs(fake, user);
let logged: string[] = [];

beforeAll(async () => {
  ctx = await createMigratedDb();
});
beforeEach(async () => {
  await resetData(ctx.client);
  as(OWNER);
  resolverDown = false;
  resolved.length = 0;
  logged = [];
  setDataLogSink((line) => logged.push(line));
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

const LISBON_TRIP = {
  stops: [{ location: { id: "lisbon" }, arrive: "2030-05-01", leave: "2030-05-04" }],
};
const create = (extra: Record<string, unknown> = {}) =>
  service.createTrip(context(), { ...LISBON_TRIP, config: CONFIG, ...extra });
const setHome = (id: string | null) =>
  service.setHomeCity(context(), { location: id === null ? null : { id } });
const storedTrips = async () =>
  (
    await ctx.client.query(
      `SELECT origin_city, origin_latitude::text AS lat, origin_longitude::text AS lng, origin_location_provider AS provider,
              travel_mode, name FROM trips ORDER BY created_at`,
    )
  ).rows;
const storedHome = async () =>
  (
    await ctx.client.query(
      `SELECT owner.id, home_city, home_latitude::text AS lat, home_longitude::text AS lng FROM users owner ORDER BY id`,
    )
  ).rows;

describe("home city", () => {
  it("is empty until set, then returns the place with its airport code, rounded coordinates and owner only", async () => {
    expect(data(await service.getHomeCity(context()))).toBeNull();
    const home = data(await setHome("seattle"));
    expect(home?.location).toMatchObject({
      id: "seattle",
      city: "Seattle",
      countryCode: "US",
      latitude: 47.61,
      longitude: -122.33,
      provider: "open-meteo",
    });
    expect(home?.airportCode).toBe("SEA");
    expect(data(await service.getHomeCity(context()))).toEqual(home);
    expect(await storedHome()).toEqual([
      { id: OWNER.userId, home_city: "Seattle", lat: "47.61", lng: "-122.33" },
    ]);
  });

  it("stores a curated place without provider fields or coordinates", async () => {
    const home = data(await setHome("paris"));
    expect(home?.location).toMatchObject({ city: "Paris", region: "Ile-de-France" });
    expect(home?.location.latitude).toBeUndefined();
    expect(home?.location.provider).toBeUndefined();
  });

  it("holds ONE home city: setting another replaces it", async () => {
    await setHome("seattle");
    expect(data(await setHome("portland"))?.location.city).toBe("Portland");
    expect(await storedHome()).toEqual([
      { id: OWNER.userId, home_city: "Portland", lat: "45.52", lng: "-122.68" },
    ]);
  });

  it("clears with null and with clearHomeCity, leaving every column empty", async () => {
    await setHome("seattle");
    expect(data(await setHome(null))).toBeNull();
    expect(await storedHome()).toEqual([
      { id: OWNER.userId, home_city: null, lat: null, lng: null },
    ]);
    await setHome("seattle");
    expect(data(await service.clearHomeCity(context()))).toBeNull();
    const [row] = (await ctx.client.query(`SELECT * FROM users`)).rows as Record<string, unknown>[];
    for (const [column, value] of Object.entries(row)) {
      if (column.startsWith("home_")) expect(value, column).toBeNull();
    }
  });

  it("refuses an unknown place (INVALID_INPUT, nothing changes) and a lookup that is down (UNAVAILABLE)", async () => {
    await setHome("seattle");
    expect(errorOf(await setHome("nowhere"))).toMatchObject({
      code: "INVALID_INPUT",
      fields: ["location"],
    });
    resolverDown = true;
    expect(errorOf(await setHome("portland"))?.code).toBe("UNAVAILABLE");
    expect(data(await service.getHomeCity(context()))?.location.city).toBe("Seattle");
  });

  it("validates its input: only a place id is read, anything else is INVALID_INPUT", async () => {
    expect(errorOf(await service.setHomeCity(context(), {}))?.code).toBe("INVALID_INPUT");
    expect(errorOf(await service.setHomeCity(context(), { location: { id: "" } }))?.code).toBe(
      "INVALID_INPUT",
    );
    // The browser's own city and coordinates are stripped, never stored.
    data(
      await service.setHomeCity(context(), {
        location: { id: "seattle", city: "Evil", latitude: 1 },
      }),
    );
    expect(data(await service.getHomeCity(context()))?.location.city).toBe("Seattle");
  });

  it("is per owner: another owner neither sees nor changes it", async () => {
    await setHome("seattle");
    as(OTHER_OWNER);
    expect(data(await service.getHomeCity(context()))).toBeNull();
    data(await setHome("lisbon"));
    data(await service.clearHomeCity(context()));
    as(OWNER);
    expect(data(await service.getHomeCity(context()))?.location.city).toBe("Seattle");
  });

  it("needs a signed-in, allowed owner", async () => {
    as(null);
    expect(errorOf(await service.getHomeCity(context()))?.code).toBe("UNAUTHENTICATED");
    expect(errorOf(await setHome("seattle"))?.code).toBe("UNAUTHENTICATED");
    expect(errorOf(await service.clearHomeCity(context()))?.code).toBe("UNAUTHENTICATED");
    as({ userId: "stranger", email: "stranger@example.test" });
    expect(errorOf(await setHome("seattle"))?.code).toBe("FORBIDDEN");
  });

  it("never logs the place", async () => {
    await setHome("seattle");
    await setHome("nowhere");
    await service.getHomeCity(context());
    await service.clearHomeCity(context());
    expect(logged.join("\n")).not.toMatch(/seattle|47\.6|122\.3/i);
  });
});

describe("a new trip's origin, mode and name", () => {
  it("defaults the origin to the home city and starts with no mode and no name", async () => {
    await setHome("seattle");
    const trip = data(await create());
    expect(trip.origin?.location.city).toBe("Seattle");
    expect(trip.origin?.airportCode).toBe("SEA");
    expect(trip.travelMode).toBeNull();
    expect(trip.name).toBeNull();
    expect(await storedTrips()).toEqual([
      {
        origin_city: "Seattle",
        lat: "47.61",
        lng: "-122.33",
        provider: "open-meteo",
        travel_mode: null,
        name: null,
      },
    ]);
  });

  it("has no origin when there is no home city", async () => {
    expect(data(await create()).origin).toBeNull();
  });

  it("takes an explicit origin, mode and trimmed name", async () => {
    await setHome("seattle");
    const trip = data(
      await create({ origin: { id: "portland" }, travelMode: "drive", name: "  Spring break  " }),
    );
    expect(trip.origin?.location.city).toBe("Portland");
    expect(trip.travelMode).toBe("drive");
    expect(trip.name).toBe("Spring break");
  });

  it("null origin means none even with a home city; a blank name is no name", async () => {
    await setHome("seattle");
    const trip = data(await create({ origin: null, name: "   ", travelMode: null }));
    expect(trip.origin).toBeNull();
    expect(trip.name).toBeNull();
    expect(trip.travelMode).toBeNull();
  });

  it("keeps its own copy: changing or clearing home later does not move the trip", async () => {
    await setHome("seattle");
    const trip = data(await create());
    await setHome("portland");
    await service.clearHomeCity(context());
    expect(data(await service.getTrip(context(), { tripId: trip.id })).origin?.location.city).toBe(
      "Seattle",
    );
  });

  it("validates mode, name length and the origin place", async () => {
    expect(errorOf(await create({ travelMode: "boat" }))?.fields).toEqual(["travelMode"]);
    expect(errorOf(await create({ name: "x".repeat(61) }))?.fields).toEqual(["name"]);
    expect(data(await create({ name: "x".repeat(60) })).name).toHaveLength(60);
    expect(errorOf(await create({ origin: { id: "nowhere" } }))).toMatchObject({
      code: "INVALID_INPUT",
      fields: ["location"],
    });
    expect(await storedTrips()).toHaveLength(1);
  });

  it("works through the combined create-with-weather-review path too", async () => {
    await setHome("seattle");
    const trip = data(
      await service.createTripWithWeatherReview(context(), {
        mode: "create",
        sourceId: null,
        ...LISBON_TRIP,
        config: CONFIG,
        theme: "travel",
        accepted: [],
        travelMode: "other",
        name: "Rail trip",
      }),
    );
    expect(trip).toMatchObject({ travelMode: "other", name: "Rail trip" });
    expect(trip.origin?.location.city).toBe("Seattle");
  });
});

describe("copying a trip", () => {
  const copy = (sourceId: string, extra: Record<string, unknown> = {}) =>
    service.copyTrip(context(), {
      sourceId,
      stops: [{ location: { id: "porto" }, arrive: "2030-09-01", leave: "2030-09-04" }],
      ...extra,
    });

  it("takes the source's travel mode, the CURRENT home city as origin, and NOT the name", async () => {
    await setHome("seattle");
    const source = data(
      await create({ travelMode: "drive", name: "Spring break", origin: { id: "portland" } }),
    );
    await setHome("lisbon");
    const copied = data(await copy(source.id));
    expect(copied.travelMode).toBe("drive");
    expect(copied.origin?.location.city).toBe("Lisbon");
    expect(copied.name).toBeNull();
  });

  it("lets the request override mode, origin and name, and null clears the inherited mode", async () => {
    const source = data(await create({ travelMode: "fly" }));
    const overridden = data(
      await copy(source.id, { travelMode: "other", origin: { id: "paris" }, name: "Again" }),
    );
    expect(overridden).toMatchObject({ travelMode: "other", name: "Again" });
    expect(overridden.origin?.location.city).toBe("Paris");
    expect(data(await copy(source.id, { travelMode: null })).travelMode).toBeNull();
  });

  it("copy through the combined path inherits the mode as well", async () => {
    const source = data(await create({ travelMode: "drive" }));
    const copied = data(
      await service.createTripWithWeatherReview(context(), {
        mode: "copy",
        sourceId: source.id,
        stops: [{ location: { id: "porto" }, arrive: "2030-09-01", leave: "2030-09-04" }],
        config: CONFIG,
        theme: "travel",
        accepted: [],
      }),
    );
    expect(copied.travelMode).toBe("drive");
  });
});

describe("updateTripTravel", () => {
  const update = (input: Record<string, unknown>) => service.updateTripTravel(context(), input);

  it("changes origin, mode and name, and reads them back", async () => {
    const trip = data(await create());
    const saved = data(
      await update({
        tripId: trip.id,
        origin: { id: "seattle" },
        travelMode: "other",
        name: " Lisbon, finally ",
      }),
    );
    expect(saved).toMatchObject({ travelMode: "other", name: "Lisbon, finally" });
    expect(saved.origin).toMatchObject({ airportCode: "SEA" });
    expect(data(await service.getTrip(context(), { tripId: trip.id }))).toMatchObject({
      travelMode: "other",
      name: "Lisbon, finally",
    });
  });

  it("leaves a field that is left out unchanged, and null clears it", async () => {
    const trip = data(await create({ origin: { id: "seattle" }, travelMode: "fly", name: "Keep" }));
    expect(data(await update({ tripId: trip.id, travelMode: "drive" }))).toMatchObject({
      travelMode: "drive",
      name: "Keep",
    });
    const cleared = data(await update({ tripId: trip.id, origin: null, name: null }));
    expect(cleared).toMatchObject({ origin: null, name: null, travelMode: "drive" });
    expect(data(await update({ tripId: trip.id, name: "   " })).name).toBeNull();
    expect(data(await update({ tripId: trip.id, travelMode: null })).travelMode).toBeNull();
    const [row] = await storedTrips();
    expect(row).toMatchObject({ origin_city: null, lat: null, travel_mode: null, name: null });
  });

  it("does not touch the packing list or the stops", async () => {
    const trip = data(await create());
    const saved = data(await update({ tripId: trip.id, travelMode: "fly" }));
    expect(saved.items.map((item) => [item.id, item.qty])).toEqual(
      trip.items.map((item) => [item.id, item.qty]),
    );
    expect(saved.stops).toHaveLength(trip.stops.length);
  });

  it("validates: nothing to change, bad mode, long name, unknown place, bad id", async () => {
    const trip = data(await create({ travelMode: "fly" }));
    expect(errorOf(await update({ tripId: trip.id }))?.code).toBe("INVALID_INPUT");
    expect(errorOf(await update({ tripId: trip.id, travelMode: "boat" }))?.fields).toEqual([
      "travelMode",
    ]);
    expect(errorOf(await update({ tripId: trip.id, name: "x".repeat(61) }))?.fields).toEqual([
      "name",
    ]);
    expect(errorOf(await update({ tripId: trip.id, origin: { id: "nowhere" } }))?.code).toBe(
      "INVALID_INPUT",
    );
    expect(errorOf(await update({ tripId: "nope", name: "x" }))?.code).toBe("INVALID_INPUT");
    resolverDown = true;
    expect(errorOf(await update({ tripId: trip.id, origin: { id: "seattle" } }))?.code).toBe(
      "UNAVAILABLE",
    );
    expect((await storedTrips())[0]).toMatchObject({ travel_mode: "fly", name: null });
  });

  it("another owner can neither read nor change the trip: NOT_FOUND, and nothing is written", async () => {
    const trip = data(await create({ name: "Mine", travelMode: "fly" }));
    as(OTHER_OWNER);
    expect(
      errorOf(await update({ tripId: trip.id, name: "Stolen", travelMode: "drive" }))?.code,
    ).toBe("NOT_FOUND");
    expect(errorOf(await service.getTrip(context(), { tripId: trip.id }))?.code).toBe("NOT_FOUND");
    expect(data(await service.listTrips(context()))).toEqual([]);
    as(OWNER);
    expect((await storedTrips())[0]).toMatchObject({ travel_mode: "fly", name: "Mine" });
  });

  it("a removed trip is NOT_FOUND, and signed-out is UNAUTHENTICATED", async () => {
    const trip = data(await create());
    data(await service.removeTrip(context(), { tripId: trip.id }));
    expect(errorOf(await update({ tripId: trip.id, name: "x" }))?.code).toBe("NOT_FOUND");
    as(null);
    expect(errorOf(await update({ tripId: trip.id, name: "x" }))?.code).toBe("UNAUTHENTICATED");
  });

  it("never logs the origin or the name", async () => {
    const trip = data(await create());
    await update({ tripId: trip.id, origin: { id: "seattle" }, name: "Secret plan" });
    await update({ tripId: trip.id, origin: { id: "nowhere" } });
    expect(logged.join("\n")).not.toMatch(/seattle|secret/i);
  });
});

describe("existing trips and stops edits", () => {
  it("a trip saved before this change reads with no origin, mode or name, and survives other saves", async () => {
    const trip = data(await create());
    await ctx.client.query(
      `UPDATE trips SET origin_city = NULL, travel_mode = NULL, name = NULL WHERE id = $1`,
      [trip.id],
    );
    const loaded = data(await service.getTrip(context(), { tripId: trip.id }));
    expect(loaded).toMatchObject({ origin: null, travelMode: null, name: null });
    data(await service.setTripTheme(context(), { tripId: trip.id, theme: "beach" }));
    expect(await storedTrips()).toEqual([
      { origin_city: null, lat: null, lng: null, provider: null, travel_mode: null, name: null },
    ]);
  });

  it("other edits keep the origin, mode and name", async () => {
    const trip = data(
      await create({ origin: { id: "seattle" }, travelMode: "drive", name: "Keep me" }),
    );
    data(await service.setTripTheme(context(), { tripId: trip.id, theme: "beach" }));
    data(
      await service.setTripStops(context(), {
        tripId: trip.id,
        stops: [{ location: { id: "porto" }, arrive: "2030-05-01", leave: "2030-05-06" }],
      }),
    );
    expect(data(await service.getTrip(context(), { tripId: trip.id }))).toMatchObject({
      travelMode: "drive",
      name: "Keep me",
      origin: { location: { city: "Seattle" } },
    });
  });

  it("the origin goes with the trip when it is permanently removed", async () => {
    await create({ origin: { id: "seattle" } });
    await ctx.client.query(`DELETE FROM trips`);
    expect(await storedTrips()).toEqual([]);
  });
});
