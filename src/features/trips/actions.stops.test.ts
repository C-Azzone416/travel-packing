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
import { createTripAction } from "./actions";
import { setStopsAction } from "./trip-actions";

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
