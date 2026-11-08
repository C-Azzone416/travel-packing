// The server actions for routes of several stops (epic #107), on the real data layer (PGlite).
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createMigratedDb, resetData } from "@/server/db/__fixtures__/db";
import type { Db } from "@/server/db/retention";
import {
  CONFIG,
  createFakeAuth,
  makeContext,
  OTHER_OWNER,
  OWNER,
  seedTrip,
  signedInAs,
} from "@/server/data/__fixtures__/seed";
import type { DataContext } from "@/server/data/context";

let current: DataContext | null = null;
vi.mock("@/server/data/runtime", () => ({ getDataContext: async () => current }));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  },
}));

import { locationById } from "@/domain/locations";
import { startDraft, setDraftStops, type DraftStop, type TripDraft } from "@/domain/trip-lifecycle";
import { createTripAction, createTripWithWeatherAction } from "./actions";
import { setStopsAction, setTravelModeAction } from "./trip-actions";

let ctx: Awaited<ReturnType<typeof createMigratedDb>>;
const fake = createFakeAuth();
const db = () => ctx.db as unknown as Db;
const as = (user: typeof OWNER | null) => signedInAs(fake, user);

beforeAll(async () => {
  ctx = await createMigratedDb();
});
beforeEach(async () => {
  await resetData(ctx.client);
  as(OWNER);
  current = makeContext(db(), fake);
});
afterAll(async () => {
  await ctx.client.close();
});

const stop = (id: string | null, arrive: string, leave: string): DraftStop => ({
  location: id ? locationById(id) : null,
  arrive,
  leave,
});
const ROUTE = [
  stop("pt-lisbon", "2030-05-01", "2030-05-04"),
  stop("fr-idf-paris", "2030-05-04", "2030-05-07"),
];
const route = (stops: DraftStop[], patch: Partial<TripDraft> = {}): TripDraft => ({
  ...setDraftStops(startDraft(CONFIG, "2030-05-01", "2030-05-04"), stops),
  ...patch,
});

describe("createTripAction with several stops", () => {
  it("saves every stop, the route as the title, and the dates the stops derive", async () => {
    const result = await createTripAction(route(ROUTE));
    if (!result.ok) throw new Error(result.code);
    expect(result.trip).toMatchObject({
      destination: "Lisbon → Paris",
      start: "2030-05-01",
      end: "2030-05-07",
    });
    expect(result.trip.stops.map((entry) => entry.location.city)).toEqual(["Lisbon", "Paris"]);
  });

  it("copies a trip with its route", async () => {
    const source = await seedTrip(db(), OWNER.userId);
    const result = await createTripAction(route(ROUTE, { mode: "copy", sourceId: source.id }));
    if (!result.ok) throw new Error(result.code);
    expect(result.trip.copiedFrom).toBe(source.id);
    expect(result.trip.stops).toHaveLength(2);
  });

  it("refuses a stop with no confirmed place, and a route with a gap", async () => {
    expect(
      await createTripAction(route([ROUTE[0], stop(null, "2030-05-04", "2030-05-06")])),
    ).toEqual({
      ok: false,
      code: "INVALID_INPUT",
    });
    expect(
      await createTripAction(route([ROUTE[0], { ...ROUTE[1], arrive: "2030-05-05" }])),
    ).toEqual({ ok: false, code: "INVALID_INPUT" });
  });
});

describe("setStopsAction", () => {
  const stored = async () => {
    const created = await createTripAction(route(ROUTE));
    if (!created.ok) throw new Error(created.code);
    return created.trip;
  };

  it("replaces the route and returns the changed trip with no signals", async () => {
    const trip = await stored();
    const result = await setStopsAction(trip.id, [
      { location: locationById("it-lazio-rome")!, arrive: "2030-05-02", leave: "2030-05-05" },
    ]);
    if (!result.ok) throw new Error(result.code);
    expect(result.signals).toEqual({ promptBagPlacement: false, reviewPrompt: false });
    expect(result.trip).toMatchObject({
      destination: "Rome",
      start: "2030-05-02",
      end: "2030-05-05",
      days: 4,
    });
    expect(result.trip.stops.map((entry) => entry.location.city)).toEqual(["Rome"]);
  });

  it("sends only each place's id: the server looks the place up itself", async () => {
    const trip = await stored();
    const forged = {
      ...locationById("it-lazio-rome")!,
      city: "Forged",
      label: "Forged",
    };
    const result = await setStopsAction(trip.id, [
      { location: forged, arrive: "2030-05-02", leave: "2030-05-05" },
    ]);
    if (!result.ok) throw new Error(result.code);
    expect(result.trip.stops[0].location.city).toBe("Rome");
  });

  it("is INVALID_INPUT for a bad route, NOT_FOUND for a missing trip or another owner's trip", async () => {
    const trip = await stored();
    const good = [
      { location: locationById("it-lazio-rome")!, arrive: "2030-05-02", leave: "2030-05-05" },
    ];
    expect(await setStopsAction(trip.id, [{ ...good[0], leave: "2030-04-01" }])).toEqual({
      ok: false,
      code: "INVALID_INPUT",
    });
    expect(await setStopsAction("00000000-0000-4000-8000-0000000000ff", good)).toEqual({
      ok: false,
      code: "NOT_FOUND",
    });
    as(OTHER_OWNER);
    expect(await setStopsAction(trip.id, good)).toEqual({ ok: false, code: "NOT_FOUND" });
  });

  it("redirects to sign-in when nobody is signed in", async () => {
    const trip = await stored();
    as(null);
    await expect(setStopsAction(trip.id, [])).rejects.toThrow(/NEXT_REDIRECT/);
  });

  it("is INTERNAL without a database configuration", async () => {
    current = null;
    expect(await setStopsAction("00000000-0000-4000-8000-0000000000ff", [])).toEqual({
      ok: false,
      code: "INTERNAL",
    });
  });
});

describe("createTripWithWeatherAction", () => {
  const umbrella = {
    kind: "add" as const,
    semanticId: "weather-umbrella",
    ruleSignature: "rain",
    item: {
      semanticId: "weather-umbrella",
      name: "Compact umbrella",
      category: "Accessories" as const,
      qty: 1,
      optional: false,
    },
  };

  it("saves a route of several stops together with the weather rows", async () => {
    const result = await createTripWithWeatherAction(route(ROUTE), [umbrella]);
    if (!result.ok) throw new Error(result.code);
    expect(result.trip.stops.map((entry) => entry.location.city)).toEqual(["Lisbon", "Paris"]);
    expect(result.trip.items.some((item) => item.id === "weather-umbrella")).toBe(true);
  });

  it("refuses a draft with no confirmed place, and is INTERNAL without a database", async () => {
    expect(
      await createTripWithWeatherAction(startDraft(CONFIG, "2030-05-01", "2030-05-03"), []),
    ).toEqual({
      ok: false,
      code: "INVALID_INPUT",
    });
    current = null;
    expect(await createTripWithWeatherAction(route(ROUTE), [])).toEqual({
      ok: false,
      code: "INTERNAL",
    });
  });

  it("sends a signed-out person to sign in and an unlisted one to access denied", async () => {
    as(null);
    await expect(createTripWithWeatherAction(route(ROUTE), [])).rejects.toThrow(
      /NEXT_REDIRECT.*sign-in/,
    );
    as({ userId: "intruder", email: "intruder@example.test" });
    await expect(createTripWithWeatherAction(route(ROUTE), [])).rejects.toThrow(
      /NEXT_REDIRECT.*access-denied/,
    );
  });
});

describe("setTravelModeAction (Edit trip, #389)", () => {
  const stored = async () => {
    const created = await createTripAction(route(ROUTE));
    if (!created.ok) throw new Error(created.code);
    return created.trip;
  };

  it("changes only the travel mode and returns the changed trip with no signals", async () => {
    const trip = await stored();
    const result = await setTravelModeAction(trip.id, "drive");
    if (!result.ok) throw new Error(result.code);
    expect(result.signals).toEqual({ promptBagPlacement: false, reviewPrompt: false });
    expect(result.trip.travelMode).toBe("drive");
    expect(result.trip.stops).toEqual(trip.stops);
    expect(result.trip.items).toEqual(trip.items);
  });

  it("is INVALID_INPUT for an unknown mode, NOT_FOUND for a missing trip or another owner's trip", async () => {
    const trip = await stored();
    expect(await setTravelModeAction(trip.id, "rocket" as never)).toEqual({
      ok: false,
      code: "INVALID_INPUT",
    });
    expect(await setTravelModeAction("00000000-0000-4000-8000-0000000000ff", "fly")).toEqual({
      ok: false,
      code: "NOT_FOUND",
    });
    as(OTHER_OWNER);
    expect(await setTravelModeAction(trip.id, "fly")).toEqual({ ok: false, code: "NOT_FOUND" });
    as(OWNER);
    // The other owner's attempt changed nothing.
    const again = await setTravelModeAction(trip.id, "other");
    if (!again.ok) throw new Error(again.code);
    expect(again.trip.travelMode).toBe("other");
  });

  it("redirects to sign-in when nobody is signed in, and is INTERNAL without a database", async () => {
    const trip = await stored();
    as(null);
    await expect(setTravelModeAction(trip.id, "fly")).rejects.toThrow(/NEXT_REDIRECT/);
    current = null;
    expect(await setTravelModeAction(trip.id, "fly")).toEqual({ ok: false, code: "INTERNAL" });
  });
});

describe("the reviewed version on the route and travel mutations (#389)", () => {
  const stored = async () => {
    const created = await createTripAction(route(ROUTE));
    if (!created.ok) throw new Error(created.code);
    return created.trip;
  };
  const rome = [
    { location: locationById("it-lazio-rome")!, arrive: "2030-05-02", leave: "2030-05-05" },
  ];

  it("setStops with the current version applies, and its answer carries the next version", async () => {
    const trip = await stored();
    expect(trip.updatedAt).toBeTruthy();
    const result = await setStopsAction(trip.id, rome, trip.updatedAt);
    if (!result.ok) throw new Error(result.code);
    expect(result.trip.stops).toHaveLength(1);
    expect(result.trip.updatedAt).not.toBe(trip.updatedAt);
  });

  it("setStops based on an older version is STALE and changes nothing", async () => {
    const trip = await stored();
    const other = await setTravelModeAction(trip.id, "drive"); // a concurrent save by the same owner
    if (!other.ok) throw new Error(other.code);
    expect(await setStopsAction(trip.id, rome, trip.updatedAt)).toEqual({
      ok: false,
      code: "STALE",
    });
    const after = await setTravelModeAction(trip.id, "drive");
    if (!after.ok) throw new Error(after.code);
    expect(after.trip.stops).toHaveLength(2);
  });

  it("setTravelMode based on an older version is STALE and changes nothing; the current one applies", async () => {
    const trip = await stored();
    const moved = await setStopsAction(trip.id, rome); // no version: unchanged behaviour
    if (!moved.ok) throw new Error(moved.code);
    expect(await setTravelModeAction(trip.id, "drive", trip.updatedAt)).toEqual({
      ok: false,
      code: "STALE",
    });
    const ok = await setTravelModeAction(trip.id, "drive", moved.trip.updatedAt);
    if (!ok.ok) throw new Error(ok.code);
    expect(ok.trip.travelMode).toBe("drive");
  });

  it("a chain of the sheet's saves, each on the version the one before returned, is accepted end to end", async () => {
    const trip = await stored();
    const first = await setStopsAction(trip.id, rome, trip.updatedAt);
    if (!first.ok) throw new Error(first.code);
    const second = await setTravelModeAction(trip.id, "other", first.trip.updatedAt);
    if (!second.ok) throw new Error(second.code);
    expect(second.trip.travelMode).toBe("other");
  });
});
